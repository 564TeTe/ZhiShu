/**
 * Vision Module
 *
 * Configurable image analysis for chat sessions. Provides:
 *  - Pluggable vision providers (OpenAI-compatible by default)
 *  - Cached analysis results keyed by image hash + provider + model
 *  - POST /api/vision/analyze and GET /api/vision/status routes
 *
 * The module is initialized once at server startup: the configured provider is
 * registered and activated, then the routes are mounted at /api/vision.
 */

export { VisionProviderRegistry } from './vision-provider-registry.js';
export { visionCache } from './vision-cache.service.js';
export {
  analyzeImage,
  checkVisionHealth,
  formatVisionAnalysisAsText,
  getVisionProviderInfo,
  hashImage,
} from './vision.service.js';
export type {
  VisionAnalysisInput,
  VisionAnalysisOutput,
  VisionErrorEntry,
  VisionProvider,
  VisionProviderInfo,
  VisionUIElement,
} from './vision-provider.interface.js';
export type {
  VisionAnalyzeErrorCode,
  VisionAnalyzeResponse,
} from './vision.service.js';
export { VisionServiceError } from './vision.service.js';

import { createAnthropicCompatibleVisionProvider } from './providers/anthropic-compatible.vision-provider.js';
import { createOpenAICompatibleVisionProvider } from './providers/openai-compatible.vision-provider.js';
import { VisionProviderRegistry } from './vision-provider-registry.js';
import visionRoutes from './vision.routes.js';

/** Boot the vision module: register providers and activate the configured one. */
export function initializeVisionModule(): void {
  // Register all available providers.
  VisionProviderRegistry.register(createOpenAICompatibleVisionProvider());
  VisionProviderRegistry.register(createAnthropicCompatibleVisionProvider());

  // Activate the configured provider. Default: anthropic-compatible (Kimi, Claude, etc.)
  const configuredProvider = process.env.ZHISHU_VISION_PROVIDER || 'anthropic-compatible';
  VisionProviderRegistry.setActive(configuredProvider);
}

export { visionRoutes };
