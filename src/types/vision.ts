/**
 * Vision / Image Processing Types (shared between client and server concepts)
 */

/**
 * Image processing mode.
 * - auto_deepseek: Auto, only assist DeepSeek text-only models (default)
 * - proxy: Always use vision proxy
 * - native: Always send images natively
 * - disabled: Block all image sending
 *
 * Legacy modes (accepted for backward compatibility but normalized server-side):
 * - auto → auto_deepseek
 * - vision → proxy
 * - off → disabled
 */
export type ImageProcessingMode = 'auto_deepseek' | 'proxy' | 'native' | 'disabled';

/** Where the current mode setting came from. */
export type ImageProcessingModeSource = 'global' | 'session';

/** Session-level DeepSeek image assist override. */
export type DeepSeekImageAssist = 'auto' | 'on' | 'off';

/** Resolved model identity from the server. */
export interface ResolvedModelIdentity {
  provider: 'deepseek' | 'anthropic' | 'openai' | 'google' | 'kimi' | 'unknown';
  modelId: string | null;
  nativeVision: 'supported' | 'unsupported' | 'unknown';
  source: 'provider' | 'model_name' | 'model_alias' | 'session_config' | 'user_override' | 'heuristic';
  matchDetail: string;
}

/** Current image processing configuration for one session. */
export interface ImageProcessingConfig {
  mode: ImageProcessingMode;
  source: ImageProcessingModeSource;
  sessionId?: string;
  /** When the vision provider is configured and reachable. */
  visionConfigured: boolean;
  /** Whether the current provider chain supports native image input. */
  nativeImageSupport: 'supported' | 'unsupported' | 'unknown';
  /** Human-readable reason for the effective strategy. */
  effectiveStrategy: 'passthrough' | 'vision-proxy' | 'blocked';
  /** Human-readable description for UI. */
  reason: string;
  /** Resolved model identity (from resolveModelIdentity). */
  modelIdentity?: ResolvedModelIdentity;
  /** Session-level DeepSeek image assist override. */
  deepseekImageAssist: DeepSeekImageAssist;
}

/** Status of one image in the composer. */
export type VisionImageStatus =
  | 'pending'
  | 'analyzing'
  | 'analyzed'
  | 'cached'
  | 'failed'
  | 'native-send'
  | 'blocked';

/** Per-image state tracked in the composer. */
export interface VisionImageState {
  /** Unique id for the image within the current compose session. */
  id: string;
  file: File;
  /** Current processing status. */
  status: VisionImageStatus;
  /** Cache key returned from server (set after first analysis). */
  cacheKey?: string;
  /** Analysis result (set after successful analysis). */
  analysis?: VisionAnalysisResult;
  /** User-facing error message. */
  error?: string;
  /** Error code for programmatic handling. */
  errorCode?: string;
}

/** Structured analysis result from /api/vision/analyze. */
export interface VisionAnalysisResult {
  provider: string;
  model: string;
  summary: string;
  visibleText: string[];
  errors: VisionErrorEntry[];
  uiElements: VisionUIElement[];
  codeClues: string[];
  suggestedChecks: string[];
  uncertainties: string[];
  confidence: number;
  latencyMs: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface VisionErrorEntry {
  type: string;
  message: string;
  location?: string;
  confidence: number;
}

export interface VisionUIElement {
  type: 'button' | 'input' | 'dialog' | 'table' | 'terminal' | 'other';
  text?: string;
  state?: string;
  position?: string;
}

/** API response from POST /api/vision/analyze. */
export interface VisionAnalyzeApiResponse {
  success: boolean;
  data?: {
    cached: boolean;
    cacheKey: string;
    analysis: VisionAnalysisResult;
  };
  error?: {
    code: string;
    message: string;
  };
}

/** API response from GET /api/settings/vision/mode. */
export interface VisionModeApiResponse {
  mode: ImageProcessingMode;
  source: ImageProcessingModeSource;
  sessionId?: string;
  deepseekImageAssist?: DeepSeekImageAssist;
}

/** API response from GET /api/settings/vision/status. */
export interface VisionStatusApiResponse {
  visionConfigured: boolean;
  nativeImageSupport: 'supported' | 'unsupported' | 'unknown';
  provider: string | null;
  modelIdentity?: ResolvedModelIdentity;
}
