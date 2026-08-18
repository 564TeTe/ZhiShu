/**
 * Anthropic-Compatible Vision Provider
 *
 * Calls any Anthropic Messages API-compatible vision endpoint.
 * Tested with: Kimi (Moonshot), Claude API, and other Anthropic-compatible proxies.
 *
 * Uses the Anthropic Messages API format:
 *   POST {base_url}/messages
 *   Header: x-api-key or Authorization: Bearer
 *   Body:   { model, max_tokens, messages: [{ role, content: [...] }] }
 *
 * Configured via environment variables:
 *   ZHISHU_VISION_BASE_URL   — API base URL (e.g. https://api.moonshot.cn/anthropic)
 *   ZHISHU_VISION_API_KEY    — API key
 *   ZHISHU_VISION_MODEL      — Model name (e.g. kimi-k2.7-code)
 *   ZHISHU_VISION_TIMEOUT_MS — Request timeout (default 30000)
 */

import type {
  VisionAnalysisInput,
  VisionAnalysisOutput,
  VisionErrorEntry,
  VisionProvider,
  VisionProviderInfo,
  VisionUIElement,
} from '../vision-provider.interface.js';

const SYSTEM_PROMPT = `You are a precise screenshot analyzer for software development. Analyze the given screenshot and return a structured JSON object. Follow these rules:

1. **summary**: One paragraph describing what the screenshot shows overall.
2. **visibleText**: Array of key visible text strings extracted VERBATIM. Include error codes, URLs, HTTP status codes, class names, method names, file names, line numbers, variable names, commands, and stack traces. Preserve original spelling and punctuation.
3. **errors**: Array of recognized errors. Each has:
   - type: e.g. "runtime", "compile", "network", "auth", "lint", "test-failure", "other"
   - message: the error text verbatim
   - location: where in the UI the error appears (e.g. "console", "dialog", "terminal", "browser-devtools")
   - confidence: 0.0 to 1.0
4. **uiElements**: Array of recognized UI components. Each has:
   - type: "button" | "input" | "dialog" | "table" | "terminal" | "other"
   - text: visible text on the element
   - state: e.g. "enabled", "disabled", "loading", "error", "active", "selected"
   - position: rough position (e.g. "top-left", "center", "bottom-right")
5. **codeClues**: Array of strings — file paths, class names, method names, or other clues that help locate the relevant code in the project.
6. **suggestedChecks**: Array of recommended follow-up actions for the developer.
7. **uncertainties**: Array of things you are NOT confident about. Never fabricate information — mark unclear items here.
8. **confidence**: Overall confidence from 0.0 to 1.0.

Return ONLY valid JSON. Do not wrap in markdown code fences. Do not include any explanatory text before or after the JSON.`;

function getEnv(key: string, defaultVal = ''): string {
  return (process.env[key] ?? defaultVal).trim();
}

interface AnthropicContentBlock {
  type: 'text';
  text: string;
}

interface AnthropicImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicMessage {
  role: 'user';
  content: (AnthropicContentBlock | AnthropicImageContentBlock)[];
}

async function callAnthropicVisionAPI(
  baseUrl: string,
  apiKey: string,
  model: string,
  imageBase64: string,
  mimeType: string,
  question: string | undefined,
  timeoutMs: number,
): Promise<VisionAnalysisOutput> {
  const startTime = Date.now();

  // Build Anthropic Messages content array
  const content: (AnthropicContentBlock | AnthropicImageContentBlock)[] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: imageBase64,
      },
    },
    {
      type: 'text',
      text: question
        ? `Question: ${question}\n\nAnalyze this screenshot and return the JSON as instructed.`
        : 'Analyze this screenshot and return the JSON as instructed.',
    },
  ];

  const messages: AnthropicMessage[] = [
    { role: 'user', content },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/messages`;

    // Try x-api-key first (Anthropic native), fall back to Bearer (common proxy format)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    // Some providers (Kimi etc.) use Bearer auth; try both
    if (apiKey.startsWith('sk-')) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      headers['x-api-key'] = apiKey;
    }

    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        messages,
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
      throw new Error(
        `Vision API 认证失败 (${status})：API Key 无效或没有权限。请检查 ZHISHU_VISION_API_KEY。`,
      );
    }
    if (status === 404) {
      throw new Error(
        `Vision API 端点或模型未找到 (${status})。请检查 ZHISHU_VISION_BASE_URL 和 ZHISHU_VISION_MODEL。`,
      );
    }
    if (status === 429) {
      throw new Error(`Vision API 请求限流 (${status})。请稍后重试。`);
    }
    throw new Error(`Vision API 错误 (${status})：${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Anthropic Messages API response format
  const contentArray = Array.isArray(data.content)
    ? (data.content as Record<string, unknown>[])
    : [];
  const textBlock = contentArray.find((b) => b.type === 'text');
  const rawText = String(textBlock?.text ?? '').trim();

  if (!rawText) {
    throw new Error('Vision API 返回了空响应。请检查模型是否支持视觉能力。');
  }

  // Strip markdown code fences if present
  const jsonText = rawText
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Vision API 返回了无效 JSON。原始响应：${rawText.slice(0, 500)}`,
    );
  }

  const usage = data.usage as Record<string, number> | undefined;

  return {
    provider: 'anthropic-compatible',
    model,
    summary: String(parsed.summary ?? ''),
    visibleText: Array.isArray(parsed.visibleText)
      ? parsed.visibleText.map(String)
      : [],
    errors: Array.isArray(parsed.errors)
      ? (parsed.errors as VisionErrorEntry[])
      : [],
    uiElements: Array.isArray(parsed.uiElements)
      ? (parsed.uiElements as VisionUIElement[])
      : [],
    codeClues: Array.isArray(parsed.codeClues)
      ? parsed.codeClues.map(String)
      : [],
    suggestedChecks: Array.isArray(parsed.suggestedChecks)
      ? parsed.suggestedChecks.map(String)
      : [],
    uncertainties: Array.isArray(parsed.uncertainties)
      ? parsed.uncertainties.map(String)
      : [],
    confidence:
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
    latencyMs,
    usage: usage
      ? {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        }
      : undefined,
  };
}

export function createAnthropicCompatibleVisionProvider(): VisionProvider {
  const baseUrl = getEnv('ZHISHU_VISION_BASE_URL');
  const apiKey = getEnv('ZHISHU_VISION_API_KEY');
  const model = getEnv('ZHISHU_VISION_MODEL');
  const timeoutMs = parseInt(getEnv('ZHISHU_VISION_TIMEOUT_MS', '30000'), 10) || 30000;

  const ready = Boolean(baseUrl && apiKey && model);

  return {
    id: 'anthropic-compatible',
    label: 'Anthropic Compatible Vision',

    async analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisOutput> {
      if (!ready) {
        throw new Error(
          '视觉服务未配置。请在 .env 中设置 ZHISHU_VISION_BASE_URL、ZHISHU_VISION_API_KEY 和 ZHISHU_VISION_MODEL。',
        );
      }

      const effectiveModel = input.model || model;
      const imageBase64 = input.imageBuffer.toString('base64');

      return callAnthropicVisionAPI(
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
      if (!ready) return false;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const url = `${baseUrl.replace(/\/+$/, '')}/messages`;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        };
        if (apiKey.startsWith('sk-')) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        } else {
          headers['x-api-key'] = apiKey;
        }

        // Send a minimal request just to check auth
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        // 401/403 = key invalid, other errors = endpoint reachable
        return response.status !== 401 && response.status !== 403;
      } catch {
        return false;
      }
    },

    getInfo(): VisionProviderInfo {
      return {
        id: 'anthropic-compatible',
        label: 'Anthropic Compatible Vision',
        configuredModel: model,
        baseUrl: baseUrl || '(not set)',
        timeoutMs,
        ready,
      };
    },
  };
}
