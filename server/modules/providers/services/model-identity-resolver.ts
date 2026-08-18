/**
 * Model Identity Resolver
 *
 * Centralized resolver that determines the real model identity from multiple
 * information sources: executor, provider, modelId, modelName, modelAlias,
 * session config, and server-side model alias mappings.
 *
 * This is the SINGLE source of truth for "is this DeepSeek or not?" and
 * "does this model support native images?".
 *
 * Capability resolution ONLY happens at:
 *  - Session creation
 *  - Provider/executor switch
 *  - Model switch
 *  - User manually changing image processing settings
 *  - User manually refreshing capability status
 *
 * It MUST NOT be called on every text message or every image send.
 */

/** Known providers that may appear through various executors. */
const DEEPSEEK_MODEL_PATTERNS = [
  // Direct DeepSeek models
  /^deepseek/i,
  /deep[-_]?seek/i,
  // DeepSeek specific model IDs
  /^ds-/i,
  /deepseek-chat/i,
  /deepseek-coder/i,
  /deepseek-reasoner/i,
  /deepseek-v/i,
  /deepseek-r/i,
];

/** Models known to have native vision/image support. */
const NATIVE_VISION_MODEL_PATTERNS: RegExp[] = [
  // Anthropic Claude vision-capable models
  /claude.*(?:opus|sonnet|haiku)/i,
  /claude-3/i,
  /claude-4/i,
  /claude-5/i,
  /claude.*vision/i,
  // OpenAI vision-capable models
  /gpt-4o/i,
  /gpt-4-turbo/i,
  /gpt-4-vision/i,
  /gpt-5/i,
  /o1/i,
  /o3/i,
  /o4/i,
  // Google Gemini (all recent models support vision)
  /gemini/i,
  // Kimi (Moonshot) vision models
  /kimi/i,
  /moonshot/i,
  // OpenCode / other known vision-supporting
  /opencode/i,
  /codex/i,
  // Cursor models (typically Claude-based, support vision)
  /cursor/i,
];

/** Provider-level identity mapping — which LLM provider maps to which identity. */
const PROVIDER_IDENTITY_MAP: Record<string, { provider: string; defaultNativeVision: 'supported' | 'unsupported' | 'unknown' }> = {
  claude: { provider: 'anthropic', defaultNativeVision: 'unknown' }, // CC Switch may proxy to non-vision
  anthropic: { provider: 'anthropic', defaultNativeVision: 'supported' },
  openai: { provider: 'openai', defaultNativeVision: 'supported' },
  google: { provider: 'google', defaultNativeVision: 'supported' },
  cursor: { provider: 'unknown', defaultNativeVision: 'unknown' },
  codex: { provider: 'unknown', defaultNativeVision: 'unknown' },
  opencode: { provider: 'unknown', defaultNativeVision: 'unknown' },
};

export interface ModelIdentityInput {
  /** The executor / LLM provider name (e.g. 'claude', 'cursor', 'codex', 'opencode'). */
  executor?: string | null;
  /** Provider identifier from the app (claude, openai, etc.). */
  provider?: string | null;
  /** Model ID as known to the provider. */
  modelId?: string | null;
  /** Human-readable model name. */
  modelName?: string | null;
  /** User-defined or system-defined model alias. */
  modelAlias?: string | null;
  /** Server-side model alias mapping (from config). */
  serverModelAliasMap?: Record<string, string> | null;
  /** Session-level DeepSeek image assist override: 'auto' | 'on' | 'off'. */
  deepseekImageAssist?: 'auto' | 'on' | 'off' | null;
}

export interface ModelIdentity {
  /** Resolved provider family. */
  provider: 'deepseek' | 'anthropic' | 'openai' | 'google' | 'kimi' | 'unknown';
  /** Canonical model identifier (best available). */
  modelId: string | null;
  /** Whether this model supports native image/vision input. */
  nativeVision: 'supported' | 'unsupported' | 'unknown';
  /** Where the identity information came from. */
  source: 'provider' | 'model_name' | 'model_alias' | 'session_config' | 'user_override' | 'heuristic';
  /** Detailed match information for debugging. */
  matchDetail: string;
}

/**
 * Normalize a string for matching: lowercase, trim, collapse whitespace.
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if a normalized model identifier matches any DeepSeek pattern.
 */
function matchesDeepSeek(normalized: string): boolean {
  return DEEPSEEK_MODEL_PATTERNS.some((p) => p.test(normalized));
}

/**
 * Check if a normalized model identifier is known to support native vision.
 */
function matchesNativeVision(normalized: string): boolean {
  return NATIVE_VISION_MODEL_PATTERNS.some((p) => p.test(normalized));
}

/**
 * Resolve the real model identity from all available information sources.
 *
 * Priority order:
 *  1. Explicit session DeepSeek image assist override ('on' → treat as deepseek)
 *  2. Model name/ID/alias contains known DeepSeek patterns
 *  3. Provider identity map
 *  4. Model name matches known native vision patterns
 *  5. Heuristic fallback
 */
export function resolveModelIdentity(input: ModelIdentityInput): ModelIdentity {
  const {
    executor,
    provider,
    modelId,
    modelName,
    modelAlias,
    serverModelAliasMap,
    deepseekImageAssist,
  } = input;

  // ---- 1. Session-level DeepSeek image assist override ----
  if (deepseekImageAssist === 'on') {
    return {
      provider: 'deepseek',
      modelId: modelId || modelName || null,
      nativeVision: 'unsupported',
      source: 'user_override',
      matchDetail: '用户手动开启当前会话的 DeepSeek 图片辅助',
    };
  }

  if (deepseekImageAssist === 'off') {
    // User explicitly disabled — defer to other sources but don't force deepseek
  }

  // ---- 2. Check model alias through server mapping ----
  if (modelAlias && serverModelAliasMap) {
    const mappedModel = serverModelAliasMap[normalize(modelAlias)];
    if (mappedModel) {
      const normalized = normalize(mappedModel);
      if (matchesDeepSeek(normalized)) {
        return {
          provider: 'deepseek',
          modelId: mappedModel,
          nativeVision: 'unsupported',
          source: 'model_alias',
          matchDetail: `模型别名 "${modelAlias}" 映射到 "${mappedModel}"，识别为 DeepSeek`,
        };
      }
      if (matchesNativeVision(normalized)) {
        return {
          provider: resolveProviderFamily(normalized),
          modelId: mappedModel,
          nativeVision: 'supported',
          source: 'model_alias',
          matchDetail: `模型别名 "${modelAlias}" 映射到 "${mappedModel}"，支持原生图片`,
        };
      }
    }
  }

  // ---- 3. Check model name / ID directly ----
  const modelCandidates = [modelName, modelId, modelAlias].filter(Boolean) as string[];
  for (const candidate of modelCandidates) {
    const normalized = normalize(candidate);

    if (matchesDeepSeek(normalized)) {
      return {
        provider: 'deepseek',
        modelId: candidate,
        nativeVision: 'unsupported',
        source: 'model_name',
        matchDetail: `模型标识 "${candidate}" 匹配 DeepSeek 模式`,
      };
    }
  }

  // ---- 4. Provider-level identity ----
  const providerKey = normalize(provider || executor || '');
  const providerIdentity = PROVIDER_IDENTITY_MAP[providerKey];

  if (providerIdentity && providerIdentity.defaultNativeVision === 'supported') {
    // Known native-vision provider
    return {
      provider: providerIdentity.provider as ModelIdentity['provider'],
      modelId: modelId || modelName || null,
      nativeVision: 'supported',
      source: 'provider',
      matchDetail: `Provider "${providerKey}" 已知支持原生图片`,
    };
  }

  // ---- 5. Check model name against native vision patterns ----
  for (const candidate of modelCandidates) {
    const normalized = normalize(candidate);
    if (matchesNativeVision(normalized)) {
      return {
        provider: resolveProviderFamily(normalized),
        modelId: candidate,
        nativeVision: 'supported',
        source: 'model_name',
        matchDetail: `模型标识 "${candidate}" 匹配已知支持图片的模型`,
      };
    }
  }

  // ---- 6. Heuristic: executor hints ----
  if (providerKey === 'cursor' || providerKey === 'codex' || providerKey === 'opencode') {
    // These could be proxying to anything — stay unknown
    return {
      provider: 'unknown',
      modelId: modelId || modelName || null,
      nativeVision: 'unknown',
      source: 'heuristic',
      matchDetail: `Executor "${providerKey}" 可能连接到任意模型，无法确认图片能力`,
    };
  }

  // ---- 7. Fallback: truly unknown ----
  return {
    provider: 'unknown',
    modelId: modelId || modelName || null,
    nativeVision: 'unknown',
    source: 'heuristic',
    matchDetail: '无法识别当前模型身份和图片能力',
  };
}

/**
 * Map a normalized model name to a provider family.
 */
function resolveProviderFamily(normalizedModelName: string): ModelIdentity['provider'] {
  if (/claude|anthropic/i.test(normalizedModelName)) return 'anthropic';
  if (/gpt|openai|o[1-9]/i.test(normalizedModelName)) return 'openai';
  if (/gemini|google/i.test(normalizedModelName)) return 'google';
  if (/kimi|moonshot/i.test(normalizedModelName)) return 'kimi';
  if (/deepseek/i.test(normalizedModelName)) return 'deepseek';
  return 'unknown';
}

/**
 * Convenience: is this identity a DeepSeek text-only model?
 */
export function isDeepSeekTextOnly(identity: ModelIdentity): boolean {
  return identity.provider === 'deepseek' && identity.nativeVision === 'unsupported';
}

/**
 * Convenience: does this identity support native images?
 */
export function supportsNativeImages(identity: ModelIdentity): boolean {
  return identity.nativeVision === 'supported';
}
