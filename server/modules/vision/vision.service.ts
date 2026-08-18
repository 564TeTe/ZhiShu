/**
 * Vision Service
 *
 * Business logic layer between the vision route handler and the provider/cache.
 *
 * Responsibilities:
 *  - Validate image content (MIME type, size, file signatures)
 *  - Route to the active vision provider via VisionProviderRegistry
 *  - Cache results via VisionCache (keyed by image hash + provider + model + prompt version)
 *  - Transform provider output into the API response shape
 *  - Never log image data or API keys
 */

import crypto from 'node:crypto';

import { VisionProviderRegistry } from './vision-provider-registry.js';
import { visionCache } from './vision-cache.service.js';
import type { VisionAnalysisOutput } from './vision-provider.interface.js';

// Current prompt version — bump when the system prompt changes to invalidate cache.
const PROMPT_VERSION = 'v1';

/** MIME types accepted for vision analysis. */
const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** Maximum image size: 10 MB. */
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/** Magic bytes for accepted image formats. */
const MAGIC_BYTES: Record<string, number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/webp': [0x52, 0x49, 0x46, 0x46], // "RIFF"
};

export type VisionAnalyzeErrorCode =
  | 'NO_PROVIDER_CONFIGURED'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'IMAGE_TOO_LARGE'
  | 'INVALID_IMAGE_SIGNATURE'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR';

export class VisionServiceError extends Error {
  constructor(
    message: string,
    public readonly code: VisionAnalyzeErrorCode,
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = 'VisionServiceError';
  }
}

/** Server-to-client response shape for /api/vision/analyze. */
export interface VisionAnalyzeResponse {
  cached: boolean;
  cacheKey: string;
  analysis: VisionAnalysisOutput;
}

/**
 * Validates image buffer against MIME type, size, and magic bytes.
 * Throws VisionServiceError on validation failure.
 */
function validateImage(
  buffer: Buffer,
  mimeType: string,
): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new VisionServiceError(
      `Unsupported image type: ${mimeType}`,
      'UNSUPPORTED_IMAGE_TYPE',
      `不支持的图片格式：${mimeType}。仅支持 PNG、JPEG 和 WebP。`,
    );
  }

  if (buffer.length > MAX_IMAGE_SIZE) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
    throw new VisionServiceError(
      `Image too large: ${sizeMB} MB`,
      'IMAGE_TOO_LARGE',
      `图片过大（${sizeMB} MB），最大支持 10 MB。`,
    );
  }

  if (buffer.length === 0) {
    throw new VisionServiceError(
      'Empty image buffer',
      'INVALID_IMAGE_SIGNATURE',
      '图片文件为空。',
    );
  }

  // Validate magic bytes
  const expectedMagic = MAGIC_BYTES[mimeType];
  if (expectedMagic) {
    const matches = expectedMagic.every((byte, index) => buffer[index] === byte);
    if (!matches) {
      throw new VisionServiceError(
        `Image signature mismatch for ${mimeType}`,
        'INVALID_IMAGE_SIGNATURE',
        `文件签名与声明的图片类型 ${mimeType} 不匹配。`,
      );
    }
  }
}

/**
 * Compute a SHA-256 hash of the image buffer for cache keying and deduplication.
 */
export function hashImage(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Formats vision analysis into compact hidden context for the agent.
 * Only the first call includes this; subsequent messages in the same
 * turn do NOT re-attach the full analysis.
 *
 * Execution requirements are only added when the user explicitly asks
 * for debugging, code fixes, or project analysis.
 */
export function formatVisionAnalysisAsText(
  analysis: VisionAnalysisOutput,
  userQuestion?: string,
): string {
  const simple = analysis.simple;
  const lines: string[] = [];

  lines.push('【截图分析】');
  lines.push(`描述：${simple?.description || analysis.summary}`);

  if (simple?.imageType) {
    lines.push(`类型：${simple.imageType}`);
  }

  const errorTexts = simple?.errorText || [];
  if (errorTexts.length > 0) {
    lines.push('错误原文：');
    for (const t of errorTexts) {
      lines.push(`  ${t}`);
    }
  }

  const keyTexts = simple?.keyText || analysis.visibleText || [];
  if (keyTexts.length > 0) {
    lines.push('关键文字：');
    for (const t of keyTexts.slice(0, 10)) {
      lines.push(`  ${t}`);
    }
  }

  if (simple?.uncertainty) {
    lines.push(`不确定：${simple.uncertainty}`);
  }

  // Only add execution requirements when the user is asking for
  // debugging/code-level work, not when they just describe/ask about a picture.
  const devIntent = userQuestion && /排查|修复|解决|修改|改代码|找.*代码|定位|debug|fix|solve/i.test(userQuestion);
  const isError = simple?.imageType === 'error_screenshot' || simple?.imageType === 'code_screenshot' || simple?.imageType === 'terminal_screenshot';

  if (devIntent || isError) {
    lines.push('');
    lines.push('【执行要求】');
    lines.push('1. 根据截图线索搜索当前项目相关代码。');
    lines.push('2. 通过代码、日志或配置验证。');
    lines.push('3. 不允许仅凭截图断定根因。');
    lines.push('4. 修改前解释根因，修改后运行适当测试。');
  }

  return lines.join('\n');
}

/**
 * Service entry point: validate, check cache, call provider, cache result.
 */
export async function analyzeImage(params: {
  imageBuffer: Buffer;
  mimeType: string;
  question?: string;
  projectPath?: string;
  forceRefresh?: boolean;
}): Promise<VisionAnalyzeResponse> {
  const { imageBuffer, mimeType, question, projectPath, forceRefresh } = params;

  // 1. Validate
  validateImage(imageBuffer, mimeType);

  // 2. Find active provider
  const provider = VisionProviderRegistry.getActive();
  if (!provider) {
    throw new VisionServiceError(
      'No vision provider configured',
      'NO_PROVIDER_CONFIGURED',
      '未配置视觉服务。请在服务端设置 ZHISHU_VISION_BASE_URL、ZHISHU_VISION_API_KEY 和 ZHISHU_VISION_MODEL。',
    );
  }

  const info = provider.getInfo();
  const model = info.configuredModel || 'default';

  // 3. Check cache (unless forceRefresh)
  const cacheKey = visionCache.buildKey({
    imageBuffer,
    provider: provider.id,
    model,
    promptVersion: PROMPT_VERSION,
  });

  if (!forceRefresh) {
    const cached = visionCache.get(cacheKey);
    if (cached) {
      return { cached: true, cacheKey, analysis: cached };
    }
  } else {
    // Invalidate any existing entry for this key
    visionCache.invalidate(cacheKey);
  }

  // 4. Call provider
  let analysis: VisionAnalysisOutput;
  try {
    console.log('[Vision] Calling provider:', provider.id, 'model:', model);
    analysis = await provider.analyzeImage({
      imageBuffer,
      mimeType,
      question: question || undefined,
      projectContext: projectPath ? { projectPath } : undefined,
      model,
    });
    console.log('[Vision] Provider returned, summary:', analysis.summary?.slice(0, 100));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();
    console.error('[Vision] Provider error:', error instanceof Error ? error.message : String(error));

    if (
      lowerMessage.includes('timeout') ||
      lowerMessage.includes('abort') ||
      lowerMessage.includes('aborted')
    ) {
      throw new VisionServiceError(
        message,
        'TIMEOUT',
        '视觉分析请求超时，请稍后重试。',
      );
    }

    if (
      lowerMessage.includes('fetch') ||
      lowerMessage.includes('connect') ||
      lowerMessage.includes('econnrefused') ||
      lowerMessage.includes('enotfound') ||
      lowerMessage.includes('network')
    ) {
      throw new VisionServiceError(
        message,
        'NETWORK_ERROR',
        '无法连接到视觉服务，请检查 Base URL 和网络连接。',
      );
    }

    if (
      lowerMessage.includes('parse') ||
      lowerMessage.includes('json') ||
      lowerMessage.includes('invalid')
    ) {
      throw new VisionServiceError(
        message,
        'PARSE_ERROR',
        '视觉服务返回了无法解析的结果，请重试。',
      );
    }

    throw new VisionServiceError(message, 'PROVIDER_ERROR', `视觉分析失败：${message}`);
  }

  // 5. Cache successful result
  visionCache.set(cacheKey, analysis);

  return { cached: false, cacheKey, analysis };
}

/**
 * Returns the active provider's info or null when none is configured.
 * Safe for diagnostic endpoints — never includes secrets.
 */
export function getVisionProviderInfo() {
  const provider = VisionProviderRegistry.getActive();
  if (!provider) {
    return null;
  }
  return provider.getInfo();
}

/**
 * Quick health check for the active provider.
 */
export async function checkVisionHealth(): Promise<boolean> {
  const provider = VisionProviderRegistry.getActive();
  if (!provider) {
    return false;
  }
  return provider.healthCheck();
}
