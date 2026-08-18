/**
 * Vision settings hook — reads and writes image processing mode settings.
 *
 * Provides:
 *  - effectiveConfig: resolved per-session config with strategy + reason
 *  - setMode: persist a new mode (global or per-session)
 *  - setDeepSeekAssist: set session-level DeepSeek image assist
 *  - refreshStatus: re-fetch vision status
 *  - loading / error state
 *
 * Key design:
 *  - Capability detection is cached server-side, NOT re-computed per message.
 *  - No vision calls for text-only messages.
 *  - Unknown model → passthrough (not vision-proxy).
 */

import { useCallback, useEffect, useState } from 'react';

import { authenticatedFetch } from '../utils/api';
import type {
  ImageProcessingConfig,
  ImageProcessingMode,
  DeepSeekImageAssist,
  VisionModeApiResponse,
  VisionStatusApiResponse,
} from '../types/vision';

interface UseVisionSettingsOptions {
  /** Provider id for capability lookup. */
  provider?: string;
  /** Session id for per-session override. */
  sessionId?: string | null;
  /** Model-level params for identity resolution. */
  executor?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  modelAlias?: string | null;
}

interface UseVisionSettingsResult {
  /** The fully resolved image processing config for the current context. */
  effectiveConfig: ImageProcessingConfig | null;
  /** Is the config currently loading? */
  loading: boolean;
  /** Persist a new mode. Pass sessionId for per-session override. */
  setMode: (mode: ImageProcessingMode, sessionId?: string | null) => Promise<void>;
  /** Set session-level DeepSeek image assist override. */
  setDeepSeekAssist: (value: DeepSeekImageAssist, sessionId: string) => Promise<void>;
  /** Re-fetch vision capability status. */
  refreshStatus: () => Promise<void>;
  /** Last fetch error. */
  error: string | null;
}

/**
 * Compute the effective strategy from mode, vision config, and native support.
 *
 * CRITICAL CHANGE from the old behavior:
 * - "unknown" nativeImageSupport + auto_deepseek → passthrough (NOT vision-proxy)
 * - Only confirmed DeepSeek text-only models (nativeVision: unsupported) get vision proxy.
 * - Unknown models are treated as capable until proven otherwise.
 */
function computeStrategy(
  mode: ImageProcessingMode,
  visionConfigured: boolean,
  nativeImageSupport: 'supported' | 'unsupported' | 'unknown',
): { effectiveStrategy: ImageProcessingConfig['effectiveStrategy']; reason: string } {
  switch (mode) {
    case 'native':
      return {
        effectiveStrategy: 'passthrough',
        reason: '用户选择原生图片模式，图片将直接发送给当前模型。',
      };

    case 'proxy':
      return {
        effectiveStrategy: 'vision-proxy',
        reason: visionConfigured
          ? '用户选择强制视觉代理模式，图片将由视觉服务分析后转为文字。'
          : '强制视觉代理模式已选择，但视觉服务未配置。请配置视觉服务或切换模式。',
      };

    case 'disabled':
      return {
        effectiveStrategy: 'blocked',
        reason: '图片处理已关闭，当前会话无法发送图片。',
      };

    case 'auto_deepseek':
    default:
      // Confirmed native support → passthrough
      if (nativeImageSupport === 'supported') {
        return {
          effectiveStrategy: 'passthrough',
          reason: '当前会话支持原生图片，将直接发送。',
        };
      }

      // Confirmed DeepSeek text-only → vision proxy
      if (nativeImageSupport === 'unsupported') {
        if (visionConfigured) {
          return {
            effectiveStrategy: 'vision-proxy',
            reason: '当前会话为 DeepSeek 纯文本模型，将使用图片辅助。仅在发送图片时调用视觉模型。',
          };
        }
        return {
          effectiveStrategy: 'blocked',
          reason: '当前会话为 DeepSeek 纯文本模型，但视觉服务未配置。请配置视觉服务或切换模式。',
        };
      }

      // UNKNOWN: DO NOT auto-proxy.
      // The model might support native images (Claude, Kimi, Gemini, GPT-4V, etc).
      // Default to passthrough — if it fails, the user can manually enable DeepSeek assist.
      return {
        effectiveStrategy: 'passthrough',
        reason: '当前模型的图片能力尚未确认。不会自动使用视觉代理。你可以为本会话启用 DeepSeek 图片辅助，或切换到支持图片的模型。',
      };
  }
}

export function useVisionSettings({
  provider,
  sessionId,
  executor,
  modelId,
  modelName,
  modelAlias,
}: UseVisionSettingsOptions = {}): UseVisionSettingsResult {
  const [config, setConfig] = useState<ImageProcessingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch mode and status in parallel
      const modeParams = new URLSearchParams();
      if (sessionId) modeParams.set('sessionId', sessionId);

      const statusParams = new URLSearchParams();
      if (provider) statusParams.set('provider', provider);
      if (executor) statusParams.set('executor', executor);
      if (modelId) statusParams.set('modelId', modelId);
      if (modelName) statusParams.set('modelName', modelName);
      if (modelAlias) statusParams.set('modelAlias', modelAlias);
      if (sessionId) statusParams.set('sessionId', sessionId);

      const [modeRes, statusRes] = await Promise.all([
        authenticatedFetch(`/api/settings/vision/mode?${modeParams.toString()}`),
        authenticatedFetch(`/api/settings/vision/status?${statusParams.toString()}`),
      ]);

      if (!modeRes.ok || !statusRes.ok) {
        throw new Error('Failed to fetch vision configuration');
      }

      const modeData: VisionModeApiResponse = await modeRes.json();
      const statusData: VisionStatusApiResponse = await statusRes.json();

      const { effectiveStrategy, reason } = computeStrategy(
        modeData.mode,
        statusData.visionConfigured,
        statusData.nativeImageSupport,
      );

      setConfig({
        mode: modeData.mode,
        source: modeData.source,
        sessionId: modeData.sessionId,
        visionConfigured: statusData.visionConfigured,
        nativeImageSupport: statusData.nativeImageSupport,
        effectiveStrategy,
        reason,
        modelIdentity: statusData.modelIdentity,
        deepseekImageAssist: modeData.deepseekImageAssist || 'auto',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      // Fallback: conservative — don't proxy for unknown
      setConfig({
        mode: 'auto_deepseek',
        source: 'global',
        visionConfigured: false,
        nativeImageSupport: 'unknown',
        effectiveStrategy: 'passthrough',
        reason: '无法获取视觉配置，默认不自动使用视觉代理。',
        deepseekImageAssist: 'auto',
      });
    } finally {
      setLoading(false);
    }
  }, [provider, sessionId, executor, modelId, modelName, modelAlias]);

  const setMode = useCallback(
    async (mode: ImageProcessingMode, targetSessionId?: string | null) => {
      const body: Record<string, unknown> = { mode };
      if (targetSessionId) {
        body.sessionId = targetSessionId;
      }

      const response = await authenticatedFetch('/api/settings/vision/mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errMsg = `Failed to update image processing mode (HTTP ${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.error?.message) {
            errMsg = errData.error.message;
          } else if (errData?.error) {
            errMsg = `Server error: ${JSON.stringify(errData.error)}`;
          }
        } catch {
          errMsg = `Server returned ${response.status}`;
        }
        throw new Error(errMsg);
      }

      // Refresh config after mutation
      await fetchConfig();
    },
    [fetchConfig],
  );

  /** Set the session-level DeepSeek image assist toggle. */
  const setDeepSeekAssist = useCallback(
    async (value: DeepSeekImageAssist, targetSessionId: string) => {
      const response = await authenticatedFetch('/api/settings/vision/deepseek-assist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: targetSessionId, value }),
      });

      if (!response.ok) {
        let errMsg = `Failed to update DeepSeek assist (HTTP ${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.error?.message) {
            errMsg = errData.error.message;
          }
        } catch {
          // use default
        }
        throw new Error(errMsg);
      }

      await fetchConfig();
    },
    [fetchConfig],
  );

  const refreshStatus = useCallback(async () => {
    await fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { effectiveConfig: config, loading, setMode, setDeepSeekAssist, refreshStatus, error };
}
