/**
 * Vision Provider Interface
 *
 * Defines the contract for pluggable vision/OCR providers. Every provider
 * implements three methods: health check, info, and image analysis.
 *
 * New providers (Gemini, Anthropic, etc.) implement this interface and register
 * with VisionProviderRegistry — no business logic changes needed upstream.
 */

/** Structured input passed to every vision provider. */
export interface VisionAnalysisInput {
  /** Raw image bytes (PNG, JPEG, or WebP). */
  imageBuffer: Buffer;
  /** MIME type of the image (e.g. "image/png"). */
  mimeType: string;
  /** Optional user question to focus the analysis. */
  question?: string;
  /** Optional project context (paths, file names). */
  projectContext?: Record<string, unknown>;
  /** Model identifier the provider should use (provider-specific). */
  model?: string;
}

/** Recognized error types from a vision analysis. */
export interface VisionErrorEntry {
  type: string;
  message: string;
  location?: string;
  confidence: number;
}

/** Recognized UI elements from a screenshot. */
export interface VisionUIElement {
  type: 'button' | 'input' | 'dialog' | 'table' | 'terminal' | 'other';
  text?: string;
  state?: string;
  position?: string;
}

/** Simplified vision output (v2) — replaces verbose structured fields. */
export interface SimpleVisionOutput {
  /** Screenshot classification. */
  imageType: 'software_screenshot' | 'error_screenshot' | 'code_screenshot' | 'terminal_screenshot' | 'document' | 'photo' | 'other';
  /** Concise Chinese description (2-3 sentences). */
  description: string;
  /** Exact error text (error codes, stack traces, URLs) — empty for photos. */
  errorText: string[];
  /** Key visible text extracted verbatim. */
  keyText: string[];
  /** Things the model is uncertain about. Empty string when none. */
  uncertainty: string;
}

/** Structured output from every vision analysis call. */
export interface VisionAnalysisOutput {
  /** Provider identifier (e.g. "openai-compatible"). */
  provider: string;
  /** Model name actually used for this call. */
  model: string;
  /** One-paragraph summary of the entire screenshot (legacy). */
  summary: string;
  /** Key visible text strings extracted verbatim (legacy). */
  visibleText: string[];
  /** Recognized errors, error codes, stack traces (legacy). */
  errors: VisionErrorEntry[];
  /** Recognized UI elements (legacy). */
  uiElements: VisionUIElement[];
  /** Code-location clues (legacy). */
  codeClues: string[];
  /** Suggested follow-up checks (legacy). */
  suggestedChecks: string[];
  /** Things the model is uncertain about (legacy). */
  uncertainties: string[];
  /** Overall confidence (legacy). */
  confidence: number;
  /** Wall-clock latency of the vision API call in milliseconds. */
  latencyMs: number;
  /** Provider-reported token usage (when available). */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Simplified v2 output — preferred for new code paths. */
  simple?: SimpleVisionOutput;
}

/** Unified vision provider contract. */
export interface VisionProvider {
  /** Unique provider key used in configuration and registry lookups. */
  readonly id: string;

  /** Human-readable label for UI and logs. */
  readonly label: string;

  /**
   * Run the vision analysis.
   *
   * Providers MUST throw on permanent failures (bad key, no permission, etc.)
   * and may return partial results with lowered confidence on soft failures.
   */
  analyzeImage(input: VisionAnalysisInput): Promise<VisionAnalysisOutput>;

  /**
   * Quick liveness check. Returns true when the provider endpoint is reachable
   * and the configured credentials are valid.
   */
  healthCheck(): Promise<boolean>;

  /**
   * Returns provider metadata for diagnostics. MUST NOT include secrets.
   */
  getInfo(): VisionProviderInfo;
}

/** Public provider metadata — safe for UI and diagnostic endpoints. */
export interface VisionProviderInfo {
  id: string;
  label: string;
  configuredModel: string;
  baseUrl: string;
  timeoutMs: number;
  ready: boolean;
}
