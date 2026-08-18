/**
 * Vision Analysis Cache
 *
 * In-memory LRU cache keyed by (imageHash + provider + model + promptVersion).
 * Prevents repeated vision API calls for the same image.
 *
 * Properties:
 *  - Max capacity (default 100 entries)
 *  - TTL (default 30 minutes)
 *  - forceRefresh bypasses the cache
 *  - Failed analyses are NOT cached
 *  - Service restart loses the cache (acceptable trade-off)
 */

import crypto from 'node:crypto';

import type { VisionAnalysisOutput } from './vision-provider.interface.js';

const DEFAULT_MAX_CAPACITY = 100;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface CacheEntry {
  output: VisionAnalysisOutput;
  storedAt: number;
}

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

type CacheStats = {
  size: number;
  capacity: number;
  hits: number;
  misses: number;
};

export class VisionCache {
  private store = new Map<string, CacheEntry>();
  private maxCapacity: number;
  private ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(maxCapacity = DEFAULT_MAX_CAPACITY, ttlMs = DEFAULT_TTL_MS) {
    this.maxCapacity = maxCapacity;
    this.ttlMs = ttlMs;
  }

  /** Build the cache key from all relevant dimensions. */
  buildKey(params: {
    imageBuffer: Buffer;
    provider: string;
    model: string;
    promptVersion: string;
  }): string {
    const imageHash = sha256(params.imageBuffer.toString('base64'));
    const composite = [
      imageHash,
      params.provider,
      params.model,
      params.promptVersion,
    ].join('|');
    return sha256(composite);
  }

  /** Retrieve a cached result. Returns null on miss or expiry. */
  get(key: string): VisionAnalysisOutput | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.store.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.output;
  }

  /** Store a result. Evicts oldest entry if at capacity. */
  set(key: string, output: VisionAnalysisOutput): void {
    // Evict oldest if at capacity
    if (this.store.size >= this.maxCapacity) {
      const oldest = this.store.keys().next().value;
      if (oldest) {
        this.store.delete(oldest);
      }
    }

    this.store.set(key, { output, storedAt: Date.now() });
  }

  /** Remove a specific key (used when forceRefresh is requested). */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Clear all cached entries. */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Diagnostic stats. */
  stats(): CacheStats {
    return {
      size: this.store.size,
      capacity: this.maxCapacity,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

/** Singleton cache used by the vision service. */
export const visionCache = new VisionCache();
