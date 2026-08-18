/**
 * OpenAI-Compatible Vision Provider
 *
 * Generic provider that calls any OpenAI-compatible vision endpoint
 * (OpenAI, DeepSeek Vision, local LLaVA, Ollama, vLLM, etc.).
 *
 * Configured via environment variables:
 *   ZHISHU_VISION_BASE_URL   - API base URL
 *   ZHISHU_VISION_API_KEY    - API key
 *   ZHISHU_VISION_MODEL      - Model name
 *   ZHISHU_VISION_TIMEOUT_MS - Request timeout (default 30000)
 */

import type {
  SimpleVisionOutput,
  VisionAnalysisInput,
  VisionAnalysisOutput,
  VisionErrorEntry,
  VisionProvider,
  VisionProviderInfo,
  VisionUIElement,
} from '../vision-provider.interface.js';

const SYSTEM_PROMPT = `你是一个精确的截图分析工具。分析用户提供的截图，返回一个 JSON 对象，字段如下：

{
  "imageType": "software_screenshot | error_screenshot | code_screenshot | terminal_screenshot | document | photo | other",
  "description": "对截图内容的简洁中文描述（2-3句话）。普通照片只描述画面内容。报错截图描述页面和错误。代码截图描述代码功能。",
  "errorText": ["错误原文，逐字提取。保留错误码、URL、HTTP状态码、类名、方法名、文件名、行号。普通照片和文档留空数组"],
  "keyText": ["关键可见文字，逐字原文。没有则留空数组"],
  "uncertainty": "确实无法确认的内容。没有则设为空字符串"
}

规则：
1. 所有自然语言描述使用中文。
2. 技术字符串（错误码、类名、方法名、URL、命令）保持原文。
3. 普通照片（人物、风景、物体）：只输出 description，errorText 和 keyText 为空数组，uncertainty 为空字符串。
4. 报错截图：准确提取错误原文到 errorText。描述错误出现的页面位置。
5. 代码/终端截图：提取关键代码片段和命令到 keyText。
6. 文档截图：提取关键文字到 keyText。
7. 不要编造信息。不确定的放 uncertainty。
8. 不要输出隐私合规建议、安全检查、代码修改建议。
9. 不要猜测代码根因。
10. 只返回 JSON，不要 markdown 代码块，不要解释。`;

function getEnv(key: string, defaultVal = ''): string {
  return (process.env[key] ?? defaultVal).trim();
}

async function callVisionAPI(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageBase64: string,
  mimeType: string,
  question: string | undefined,
  timeoutMs: number,
): Promise<VisionAnalysisOutput> {
  const startTime = Date.now();

  const userContent: unknown[] = [
    {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${imageBase64}`,
      },
    },
    {
      type: 'text',
      text: question
        ? `Question: ${question}\n\nAnalyze this screenshot and return the JSON as instructed.`
        : 'Analyze this screenshot and return the JSON as instructed.',
    },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        max_tokens: 4096,
        // Kimi requires temperature=1; removing lets each API use its default
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const status = response.status;

    if (status === 401 || status === 403) {
      throw new Error(`Vision API authentication failed (${status}): Invalid API key or insufficient permissions`);
    }
    if (status === 404) {
      throw new Error(`Vision API endpoint or model not found (${status}): ${errorText.slice(0, 200)}`);
    }
    if (status === 429) {
      throw new Error(`Vision API rate limited (${status}). Please wait and try again.`);
    }
    throw new Error(`Vision API error (${status}): ${errorText.slice(0, 200)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  if (choices.length === 0) {
    throw new Error('Vision API returned no choices in response');
  }

  const messageContent = (choices[0] as Record<string, unknown>)?.message;
  if (!messageContent || typeof messageContent !== 'object') {
    throw new Error('Vision API response missing message content');
  }

  const rawText = String((messageContent as Record<string, unknown>).content ?? '').trim();

  // Strip markdown code fences if present
  const jsonText = rawText
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    // The model may have returned natural language instead of JSON.
    // Treat the entire response as a summary.
    console.warn('[Vision] Model did not return valid JSON, using raw text as summary.');
    console.warn('[Vision] Raw content (first 500 chars):', rawText.slice(0, 500));

    parsed = {
      summary: rawText.slice(0, 2000),
      visibleText: [] as string[],
      errors: [] as VisionErrorEntry[],
      uiElements: [] as VisionUIElement[],
      codeClues: [] as string[],
      suggestedChecks: [] as string[],
      uncertainties: ['模型未返回结构化 JSON，已将原始回复作为摘要。'],
      confidence: 0.5,
    };
  }

  // Parse simplified v2 fields (preferred) or fall back to legacy
  const simple = parsed.imageType ? {
    imageType: String(parsed.imageType || 'other') as SimpleVisionOutput['imageType'],
    description: String(parsed.description ?? parsed.summary ?? ''),
    errorText: Array.isArray(parsed.errorText) ? parsed.errorText.map(String) : [],
    keyText: Array.isArray(parsed.keyText) ? parsed.keyText.map(String) : [],
    uncertainty: String(parsed.uncertainty ?? ''),
  } : undefined;

  // Fill legacy fields from simple or raw parsed
  const summary = simple?.description || String(parsed.summary ?? '');
  const visibleText = simple?.keyText || (
    Array.isArray(parsed.visibleText) ? parsed.visibleText.map(String) : []
  );

  const usage = data.usage as Record<string, number> | undefined;

  return {
    provider: 'openai-compatible',
    model,
    summary,
    visibleText,
    errors: Array.isArray(parsed.errors) ? (parsed.errors as VisionErrorEntry[]) : [],
    uiElements: Array.isArray(parsed.uiElements) ? (parsed.uiElements as VisionUIElement[]) : [],
    codeClues: Array.isArray(parsed.codeClues) ? parsed.codeClues.map(String) : [],
    suggestedChecks: Array.isArray(parsed.suggestedChecks) ? parsed.suggestedChecks.map(String) : [],
    uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties.map(String) : [],
    confidence: typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    latencyMs,
    usage: usage ? {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    } : undefined,
    simple,
  };
}

export function createOpenAICompatibleVisionProvider(): VisionProvider {
  const baseUrl = getEnv('ZHISHU_VISION_BASE_URL');
  const apiKey = getEnv('ZHISHU_VISION_API_KEY');
  const model = getEnv('ZHISHU_VISION_MODEL');
  const timeoutMs = parseInt(getEnv('ZHISHU_VISION_TIMEOUT_MS', '30000'), 10) || 30000;

  const ready = Boolean(baseUrl && apiKey && model);

  return {
    id: 'openai-compatible',
    label: 'OpenAI Compatible Vision',

    async analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisOutput> {
      if (!ready) {
        throw new Error(
          'Vision provider is not configured. Set ZHISHU_VISION_BASE_URL, ZHISHU_VISION_API_KEY, and ZHISHU_VISION_MODEL.',
        );
      }

      const effectiveModel = input.model || model;
      const imageBase64 = input.imageBuffer.toString('base64');

      return callVisionAPI(
        baseUrl,
        apiKey,
        effectiveModel,
        imageBase64,
        input.mimeType,
        input.question || undefined,
        timeoutMs,
      );
    },

    async healthCheck(): Promise<boolean> {
      if (!ready) {
        return false;
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const url = `${baseUrl.replace(/\/+$/, '')}/models`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });

        clearTimeout(timeout);
        return response.ok;
      } catch {
        return false;
      }
    },

    getInfo(): VisionProviderInfo {
      return {
        id: 'openai-compatible',
        label: 'OpenAI Compatible Vision',
        configuredModel: model,
        baseUrl: baseUrl || '(not set)',
        timeoutMs,
        ready,
      };
    },
  };
}
