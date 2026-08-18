export { sessionSynchronizerService } from './services/session-synchronizer.service.js';
export { providerSkillsService } from './services/skills.service.js';
export { providerMcpService } from './services/mcp.service.js';
export { providerRuntimeService } from './services/provider-runtime.service.js';
export { providerCapabilitiesService } from './services/provider-capabilities.service.js';
export {
  isDeepSeekTextOnly,
  resolveModelIdentity,
  supportsNativeImages,
} from './services/model-identity-resolver.js';
export type {
  ModelIdentity,
  ModelIdentityInput,
} from './services/model-identity-resolver.js';

// providerModelsService: used by Commands to list models and resolve the active session model.
export { providerModelsService } from './services/provider-models.service.js';

export { initializeSessionsWatcher } from './services/sessions-watcher.service.js';
export { closeSessionsWatcher } from './services/sessions-watcher.service.js';
