/**
 * Vision Analyzer — client-side API client for the vision analysis endpoint.
 *
 * Handles:
 *  - Uploading an image to POST /api/vision/analyze
 *  - Caching and reusing results on the client side
 *  - Error classification into user-friendly messages
 */

import { authenticatedFetch } from '../../../utils/api';
import type {
  VisionAnalyzeApiResponse,
  VisionAnalysisResult,
} from '../../../types/vision';

export interface AnalyzeImageParams {
  file: File;
  question?: string;
  projectPath?: string;
  forceRefresh?: boolean;
}

export type AnalyzeImageErrorCode =
  | 'NO_PROVIDER_CONFIGURED'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'IMAGE_TOO_LARGE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'PROVIDER_ERROR'
  | 'UPLOAD_ERROR'
  | 'UNKNOWN';

export class AnalyzeImageError extends Error {
  constructor(
    message: string,
    public readonly code: AnalyzeImageErrorCode,
  ) {
    super(message);
    this.name = 'AnalyzeImageError';
  }
}

/**
 * Maps server error codes to user-friendly Chinese messages.
 */
function mapErrorMessage(code: string, serverMessage: string): string {
  switch (code) {
    case 'NO_PROVIDER_CONFIGURED':
      return '未配置视觉服务。请在 .env 中设置 ZHISHU_VISION_BASE_URL、ZHISHU_VISION_API_KEY 和 ZHISHU_VISION_MODEL。';
    case 'UNSUPPORTED_IMAGE_TYPE':
      return '不支持的图片格式。仅支持 PNG、JPEG 和 WebP。';
    case 'IMAGE_TOO_LARGE':
      return '图片过大，最大支持 10 MB。';
    case 'TIMEOUT':
      return '视觉分析超时，请稍后重试。';
    case 'NETWORK_ERROR':
      return '无法连接到视觉服务，请检查网络和服务端配置。';
    case 'PARSE_ERROR':
      return serverMessage || '视觉服务返回了无法解析的结果，请重试。';
    default:
      return serverMessage || '视觉分析失败，请重试。';
  }
}

/**
 * Analyze one image via the vision API.
 *
 * Returns:
 *   { cached: boolean, cacheKey: string, analysis: VisionAnalysisResult }
 *
 * Throws AnalyzeImageError with a user-friendly message on failure.
 */
export async function analyzeImage(params: AnalyzeImageParams): Promise<{
  cached: boolean;
  cacheKey: string;
  analysis: VisionAnalysisResult;
}> {
  const { file, question, projectPath, forceRefresh } = params;

  const formData = new FormData();
  formData.append('image', file);
  if (question) formData.append('question', question);
  if (projectPath) formData.append('projectPath', projectPath);
  if (forceRefresh) formData.append('forceRefresh', 'true');

  let response: Response;
  try {
    response = await authenticatedFetch('/api/vision/analyze', {
      method: 'POST',
      headers: {}, // Let browser set Content-Type for FormData
      body: formData,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AnalyzeImageError(
      `网络请求失败：${message}`,
      'NETWORK_ERROR',
    );
  }

  const data: VisionAnalyzeApiResponse = await response.json().catch(() => ({
    success: false,
    error: { code: 'UNKNOWN', message: '无法解析服务端响应。' },
  }));

  if (!data.success || !data.data) {
    const code = (data.error?.code || 'UNKNOWN') as AnalyzeImageErrorCode;
    const serverMessage = data.error?.message || '未知错误';
    throw new AnalyzeImageError(mapErrorMessage(code, serverMessage), code);
  }

  return {
    cached: data.data.cached,
    cacheKey: data.data.cacheKey,
    analysis: data.data.analysis,
  };
}

/**
 * Formats a VisionAnalysisResult into a text block for the agent's context.
 */
export function formatAnalysisAsText(analysis: VisionAnalysisResult, userQuestion?: string): string {
  // Extract simple v2 fields if available (server may return them)
  const raw = analysis as unknown as Record<string, unknown>;
  const simple = raw.simple as Record<string, unknown> | undefined;
  const desc = (simple?.description as string) || analysis.summary || '';
  const imgType = (simple?.imageType as string) || 'other';
  const errorTexts = (simple?.errorText as string[]) || [];
  const keyTexts = (simple?.keyText as string[]) || analysis.visibleText || [];
  const uncertainty = (simple?.uncertainty as string) || '';

  const lines: string[] = [];
  lines.push('【截图分析】');
  lines.push(`描述：${desc}`);
  lines.push(`类型：${imgType}`);

  if (errorTexts.length > 0) {
    lines.push('错误原文：');
    for (const t of errorTexts) lines.push(`  ${t}`);
  }

  if (keyTexts.length > 0) {
    lines.push('关键文字：');
    for (const t of keyTexts.slice(0, 10)) lines.push(`  ${t}`);
  }

  if (uncertainty) lines.push(`不确定：${uncertainty}`);

  // Only add execution requirements for dev/debug intent
  const devIntent = userQuestion && /排查|修复|解决|修改|改代码|找.*代码|定位|debug|fix|solve/i.test(userQuestion);
  const isError = imgType === 'error_screenshot' || imgType === 'code_screenshot' || imgType === 'terminal_screenshot';

  if (devIntent || isError) {
    lines.push('');
    lines.push('【执行要求】');
    lines.push('1. 根据截图线索搜索当前项目相关代码。');
    lines.push('2. 通过代码、日志或配置验证，不允许仅凭截图断定根因。');
    lines.push('3. 修改前解释根因，修改后运行适当测试。');
  }

  return lines.join('\n');
}
