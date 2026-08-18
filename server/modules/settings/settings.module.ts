import {
  apiKeysDb,
  appConfigDb,
  credentialsDb,
  notificationPreferencesDb,
  pushSubscriptionsDb,
} from '@/modules/database/index.js';
import {
  createNotificationEvent,
  getPublicKey,
  notifyUserIfEnabled,
} from '@/modules/notifications/index.js';
import { providerCapabilitiesService } from '@/modules/providers/index.js';
import { VisionProviderRegistry } from '@/modules/vision/index.js';

import { createSettingsRouter } from './settings.routes.js';
import { createSettingsService } from './settings.service.js';

const settingsService = createSettingsService({
  apiKeys: {
    list: (userId) => apiKeysDb.getApiKeys(userId),
    create: (userId, keyName) => apiKeysDb.createApiKey(userId, keyName),
    remove: (userId, keyId) => apiKeysDb.deleteApiKey(userId, keyId),
    toggle: (userId, keyId, isActive) => apiKeysDb.toggleApiKey(userId, keyId, isActive),
  },
  credentials: {
    list: (userId, type) => credentialsDb.getCredentials(userId, type),
    create: (userId, name, type, value, description) =>
      credentialsDb.createCredential(userId, name, type, value, description),
    remove: (userId, credentialId) => credentialsDb.deleteCredential(userId, credentialId),
    toggle: (userId, credentialId, isActive) =>
      credentialsDb.toggleCredential(userId, credentialId, isActive),
  },
  notifications: {
    getPreferences: (userId) => notificationPreferencesDb.getPreferences(userId),
    updatePreferences: (userId, preferences) =>
      notificationPreferencesDb.updatePreferences(userId, preferences),
    createEnabledEvent: () => createNotificationEvent({
      provider: 'system', kind: 'info', code: 'push.enabled',
      meta: { message: 'Push notifications are now enabled!' }, severity: 'info',
    }),
    notifyUser: (userId, event) => notifyUserIfEnabled({ userId, event }),
  },
  pushSubscriptions: {
    save: (userId, endpoint, p256dh, auth) =>
      pushSubscriptionsDb.saveSubscription(userId, endpoint, p256dh, auth),
    remove: (endpoint) => pushSubscriptionsDb.removeSubscription(endpoint),
  },
  getVapidPublicKey: getPublicKey,
  appConfig: {
    get: (key) => appConfigDb.get(key),
    set: (key, value) => appConfigDb.set(key, value),
  },
  getProviderNativeImageSupport: (provider: string) => {
    try {
      const caps = providerCapabilitiesService.getProviderCapabilities(provider as never);
      return caps?.nativeImageSupport ?? 'unknown';
    } catch {
      return 'unknown';
    }
  },
  getVisionConfigured: () => VisionProviderRegistry.isReady(),
  // Server-side model alias map — reads from app config.
  // Users can set model aliases via settings that map from a display name to a real model ID.
  getServerModelAliasMap: () => {
    try {
      const raw = appConfigDb.get('model.aliases');
      if (raw) {
        return JSON.parse(raw) as Record<string, string>;
      }
    } catch {
      // Not configured or invalid JSON
    }
    return null;
  },
});

/** Settings router assembled for the authenticated server mount. */
export const settingsRoutes = createSettingsRouter(settingsService);
