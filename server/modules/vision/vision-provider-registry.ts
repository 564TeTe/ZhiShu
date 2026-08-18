/**
 * Vision Provider Registry
 *
 * Central registry for vision/OCR providers. The server configuration selects
 * which provider is active via ZHISHU_VISION_PROVIDER env var. Each registered
 * provider maps to a unique id string.
 *
 * Public API:
 *   VisionProviderRegistry.register(provider)
 *   VisionProviderRegistry.getActive() → VisionProvider | null
 *   VisionProviderRegistry.get(id) → VisionProvider | null
 *   VisionProviderRegistry.list() → VisionProvider[]
 */

import type { VisionProvider } from './vision-provider.interface.js';

class _VisionProviderRegistry {
  private providers = new Map<string, VisionProvider>();
  private activeId: string | null = null;

  /** Register a provider. Replaces any existing provider with the same id. */
  register(provider: VisionProvider): void {
    this.providers.set(provider.id, provider);
  }

  /** Set the active provider by id. Must have been registered first. */
  setActive(id: string): void {
    this.activeId = id;
  }

  /** Retrieve a provider by id. */
  get(id: string): VisionProvider | null {
    return this.providers.get(id) ?? null;
  }

  /** Retrieve the currently active provider. */
  getActive(): VisionProvider | null {
    if (!this.activeId) {
      return null;
    }
    return this.get(this.activeId) ?? null;
  }

  /** List all registered providers. */
  list(): VisionProvider[] {
    return Array.from(this.providers.values());
  }

  /** Check whether any provider is registered and active. */
  isReady(): boolean {
    const active = this.getActive();
    return active !== null;
  }
}

/** Singleton registry instance. */
export const VisionProviderRegistry = new _VisionProviderRegistry();
