import { AppError } from '@/shared/utils.js';
import {
  resolveModelIdentity,
  type ModelIdentityInput,
} from '@/modules/providers/index.js';

type ApiKeyRow = Record<string, unknown> & { api_key: string };
type NotificationPreferences = Record<string, unknown> & {
  channels?: Record<string, unknown> & { webPush?: boolean };
};

/**
 * Supported image processing modes.
 * Legacy modes are accepted for backward compatibility and normalized:
 *   auto → auto_deepseek
 *   vision → proxy
 *   off → disabled
 */
export type ImageProcessingMode = 'auto_deepseek' | 'proxy' | 'native' | 'disabled';

export type DeepSeekImageAssist = 'auto' | 'on' | 'off';

/** Legacy mode mapping for backward compatibility. */
const LEGACY_MODE_MAP: Record<string, ImageProcessingMode> = {
  auto: 'auto_deepseek',
  vision: 'proxy',
  off: 'disabled',
};

const VALID_IMAGE_PROCESSING_MODES: ReadonlySet<string> = new Set([
  'auto_deepseek', 'proxy', 'native', 'disabled',
  // Legacy modes
  'auto', 'vision', 'off',
]);

const VALID_DEEPSEEK_ASSIST_VALUES: ReadonlySet<string> = new Set(['auto', 'on', 'off']);

/** Normalize a mode value, mapping legacy modes to their current equivalents. */
function normalizeMode(mode: string): ImageProcessingMode {
  const lower = mode.toLowerCase().trim();
  return LEGACY_MODE_MAP[lower] || (lower as ImageProcessingMode);
}

type SettingsDependencies = {
  apiKeys: {
    list(userId: number): ApiKeyRow[];
    create(userId: number, keyName: string): unknown;
    remove(userId: number, keyId: number): boolean;
    toggle(userId: number, keyId: number, isActive: boolean): boolean;
  };
  credentials: {
    list(userId: number, credentialType: string | null): unknown[];
    create(
      userId: number,
      name: string,
      type: string,
      value: string,
      description: string | null,
    ): unknown;
    remove(userId: number, credentialId: number): boolean;
    toggle(userId: number, credentialId: number, isActive: boolean): boolean;
  };
  notifications: {
    getPreferences(userId: number): NotificationPreferences | undefined;
    updatePreferences(userId: number, preferences: NotificationPreferences): unknown;
    createEnabledEvent(): unknown;
    notifyUser(userId: number, event: unknown): void | Promise<void>;
  };
  pushSubscriptions: {
    save(userId: number, endpoint: string, p256dh: string, auth: string): void;
    remove(endpoint: string): void;
  };
  getVapidPublicKey(): string | null;
  /** Key-value config store for image processing mode. */
  appConfig: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** Returns the current nativeImageSupport for a given provider. */
  getProviderNativeImageSupport?: (provider: string) => 'supported' | 'unsupported' | 'unknown';
  /** Returns whether a vision provider is configured and healthy. */
  getVisionConfigured?: () => boolean;
  /** Returns server-side model alias map from config. */
  getServerModelAliasMap?: () => Record<string, string> | null;
};

function requiredString(value: unknown, fieldName: string, code: string): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue) {
    throw new AppError(`${fieldName} is required`, { code, statusCode: 400 });
  }
  return normalizedValue;
}

function assertFound(found: boolean, resourceName: string, code: string): void {
  if (!found) {
    throw new AppError(`${resourceName} not found`, { code, statusCode: 404 });
  }
}

/** Creates settings workflows with repositories and notification effects injected. */
export function createSettingsService(dependencies: SettingsDependencies) {
  return {
    listApiKeys(userId: number) {
      const apiKeys = dependencies.apiKeys.list(userId).map((key) => ({
        ...key,
        api_key: `${key.api_key.substring(0, 10)}...`,
      }));
      return { apiKeys };
    },
    createApiKey(userId: number, keyNameInput: unknown) {
      const keyName = requiredString(keyNameInput, 'Key name', 'API_KEY_NAME_REQUIRED');
      return { success: true, apiKey: dependencies.apiKeys.create(userId, keyName) };
    },
    deleteApiKey(userId: number, keyId: number) {
      assertFound(dependencies.apiKeys.remove(userId, keyId), 'API key', 'API_KEY_NOT_FOUND');
      return { success: true };
    },
    toggleApiKey(userId: number, keyId: number, isActive: unknown) {
      if (typeof isActive !== 'boolean') {
        throw new AppError('isActive must be a boolean', {
          code: 'INVALID_ACTIVE_STATE',
          statusCode: 400,
        });
      }
      assertFound(
        dependencies.apiKeys.toggle(userId, keyId, isActive),
        'API key',
        'API_KEY_NOT_FOUND',
      );
      return { success: true };
    },
    listCredentials(userId: number, credentialType: string | null) {
      return { credentials: dependencies.credentials.list(userId, credentialType) };
    },
    createCredential(userId: number, input: Record<string, unknown>) {
      const credentialName = requiredString(
        input.credentialName,
        'Credential name',
        'CREDENTIAL_NAME_REQUIRED',
      );
      const credentialType = requiredString(
        input.credentialType,
        'Credential type',
        'CREDENTIAL_TYPE_REQUIRED',
      );
      const credentialValue = requiredString(
        input.credentialValue,
        'Credential value',
        'CREDENTIAL_VALUE_REQUIRED',
      );
      const description = typeof input.description === 'string'
        ? input.description.trim() || null
        : null;
      return {
        success: true,
        credential: dependencies.credentials.create(
          userId,
          credentialName,
          credentialType,
          credentialValue,
          description,
        ),
      };
    },
    deleteCredential(userId: number, credentialId: number) {
      assertFound(
        dependencies.credentials.remove(userId, credentialId),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    toggleCredential(userId: number, credentialId: number, isActive: unknown) {
      if (typeof isActive !== 'boolean') {
        throw new AppError('isActive must be a boolean', {
          code: 'INVALID_ACTIVE_STATE',
          statusCode: 400,
        });
      }
      assertFound(
        dependencies.credentials.toggle(userId, credentialId, isActive),
        'Credential',
        'CREDENTIAL_NOT_FOUND',
      );
      return { success: true };
    },
    getNotificationPreferences(userId: number) {
      return { success: true, preferences: dependencies.notifications.getPreferences(userId) };
    },
    updateNotificationPreferences(userId: number, preferences: NotificationPreferences) {
      return {
        success: true,
        preferences: dependencies.notifications.updatePreferences(userId, preferences),
      };
    },
    getVapidPublicKey() {
      return { publicKey: dependencies.getVapidPublicKey() };
    },
    subscribeToPush(userId: number, input: Record<string, unknown>) {
      const endpoint = requiredString(input.endpoint, 'Endpoint', 'PUSH_SUBSCRIPTION_REQUIRED');
      const keys = typeof input.keys === 'object' && input.keys !== null
        ? input.keys as Record<string, unknown>
        : {};
      const p256dh = requiredString(keys.p256dh, 'p256dh', 'PUSH_SUBSCRIPTION_REQUIRED');
      const auth = requiredString(keys.auth, 'auth', 'PUSH_SUBSCRIPTION_REQUIRED');
      dependencies.pushSubscriptions.save(userId, endpoint, p256dh, auth);

      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (!currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences?.channels, webPush: true },
        });
      }
      const event = dependencies.notifications.createEnabledEvent();
      void dependencies.notifications.notifyUser(userId, event);
      return { success: true };
    },
    unsubscribeFromPush(userId: number, endpointInput: unknown) {
      const endpoint = requiredString(endpointInput, 'Endpoint', 'PUSH_ENDPOINT_REQUIRED');
      dependencies.pushSubscriptions.remove(endpoint);
      const currentPreferences = dependencies.notifications.getPreferences(userId);
      if (currentPreferences?.channels?.webPush) {
        dependencies.notifications.updatePreferences(userId, {
          ...currentPreferences,
          channels: { ...currentPreferences.channels, webPush: false },
        });
      }
      return { success: true };
    },

    // ---- Image processing mode ----

    getImageProcessingMode(userId: number, sessionId: string | null) {
      void userId;

      // Per-session override takes priority
      if (sessionId) {
        const sessionMode = dependencies.appConfig.get(`vision.mode.session.${sessionId}`);
        if (sessionMode && VALID_IMAGE_PROCESSING_MODES.has(sessionMode)) {
          const assist = dependencies.appConfig.get(`vision.deepseekAssist.session.${sessionId}`);
          return {
            mode: normalizeMode(sessionMode),
            source: 'session' as const,
            sessionId,
            deepseekImageAssist: assist && VALID_DEEPSEEK_ASSIST_VALUES.has(assist)
              ? (assist as DeepSeekImageAssist)
              : ('auto' as DeepSeekImageAssist),
          };
        }
      }

      // Global default
      const globalMode = dependencies.appConfig.get('vision.mode.global') || 'auto_deepseek';
      const mode = VALID_IMAGE_PROCESSING_MODES.has(globalMode)
        ? normalizeMode(globalMode)
        : 'auto_deepseek';

      return { mode, source: 'global' as const, deepseekImageAssist: 'auto' as DeepSeekImageAssist };
    },

    setImageProcessingMode(userId: number, mode: unknown, sessionId: string | null) {
      void userId;

      const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
      if (!VALID_IMAGE_PROCESSING_MODES.has(normalizedMode)) {
        throw new AppError(
          `Invalid image processing mode: "${String(mode)}". Must be one of: auto_deepseek, proxy, native, disabled.`,
          { code: 'INVALID_IMAGE_PROCESSING_MODE', statusCode: 400 },
        );
      }

      const resolvedMode = normalizeMode(normalizedMode);
      const key = sessionId
        ? `vision.mode.session.${sessionId}`
        : 'vision.mode.global';

      dependencies.appConfig.set(key, resolvedMode);

      return {
        success: true,
        mode: resolvedMode,
        source: sessionId ? ('session' as const) : ('global' as const),
        sessionId: sessionId || undefined,
      };
    },

    /**
     * Set the session-level DeepSeek image assist override.
     * Called when user changes "当前会话启用 DeepSeek 图片辅助" toggle.
     */
    setDeepSeekImageAssist(userId: number, sessionId: string, value: unknown) {
      void userId;

      if (!sessionId) {
        throw new AppError('sessionId is required for session-level override', {
          code: 'SESSION_ID_REQUIRED', statusCode: 400,
        });
      }

      const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (!VALID_DEEPSEEK_ASSIST_VALUES.has(normalized)) {
        throw new AppError(
          `Invalid DeepSeek image assist value: "${String(value)}". Must be one of: auto, on, off.`,
          { code: 'INVALID_DEEPSEEK_ASSIST', statusCode: 400 },
        );
      }

      dependencies.appConfig.set(
        `vision.deepseekAssist.session.${sessionId}`,
        normalized,
      );

      return {
        success: true,
        deepseekImageAssist: normalized as DeepSeekImageAssist,
        sessionId,
      };
    },

    /**
     * Get vision status including resolved model identity.
     *
     * Accepts optional model-level params so the server can resolve model
     * identity without the frontend guessing. When omitted, falls back to
     * provider-level capabilities only.
     */
    getVisionStatus(
      userId: number,
      provider: string | null,
      modelParams?: {
        executor?: string | null;
        modelId?: string | null;
        modelName?: string | null;
        modelAlias?: string | null;
        sessionId?: string | null;
      } | null,
    ) {
      void userId;

      const visionConfigured = dependencies.getVisionConfigured?.() ?? false;

      // If model params are provided, resolve identity through the central resolver
      if (modelParams && (modelParams.modelId || modelParams.modelName || modelParams.executor)) {
        const deepseekAssist = modelParams.sessionId
          ? dependencies.appConfig.get(`vision.deepseekAssist.session.${modelParams.sessionId}`)
          : null;

        const identityInput: ModelIdentityInput = {
          executor: modelParams.executor || provider,
          provider,
          modelId: modelParams.modelId,
          modelName: modelParams.modelName,
          modelAlias: modelParams.modelAlias,
          serverModelAliasMap: dependencies.getServerModelAliasMap?.() ?? null,
          deepseekImageAssist: deepseekAssist && VALID_DEEPSEEK_ASSIST_VALUES.has(deepseekAssist)
            ? (deepseekAssist as DeepSeekImageAssist)
            : 'auto',
        };

        const modelIdentity = resolveModelIdentity(identityInput);

        return {
          visionConfigured,
          nativeImageSupport: modelIdentity.nativeVision,
          provider: provider || null,
          modelIdentity,
        };
      }

      // Fallback: provider-level only (legacy path for simple capability checks)
      const nativeSupport = provider
        ? (dependencies.getProviderNativeImageSupport?.(provider) ?? 'unknown')
        : 'unknown';

      return {
        visionConfigured,
        nativeImageSupport: nativeSupport,
        provider: provider || null,
      };
    },
  };
}
