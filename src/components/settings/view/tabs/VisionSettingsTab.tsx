/**
 * Vision / Image Processing Settings Tab
 *
 * Configures how images are handled in chat:
 *  - auto_deepseek: Auto, only assist DeepSeek text-only models (default)
 *  - proxy: Always use vision analysis proxy
 *  - native: Always send images natively
 *  - disabled: Block all image sending
 *
 * Also provides session-level DeepSeek image assist toggle for unknown models.
 */

import { useCallback, useEffect, useState } from 'react';

import { useVisionSettings } from '../../../../hooks/useVisionSettings';
import { authenticatedFetch } from '../../../../utils/api';
import type { ImageProcessingMode, DeepSeekImageAssist } from '../../../../types/vision';
import SettingsSection from '../SettingsSection';
import SettingsRow from '../SettingsRow';
import SettingsCard from '../SettingsCard';

const MODE_OPTIONS: { value: ImageProcessingMode; label: string; description: string }[] = [
  {
    value: 'auto_deepseek',
    label: '自动（仅 DeepSeek）',
    description: '仅在识别为 DeepSeek 纯文本模型时提供图片辅助，无图片时不产生额外消耗。',
  },
  {
    value: 'proxy',
    label: '强制视觉代理',
    description: '始终使用外部视觉模型分析图片，将结果转为文字后发送。适合不支持图片的模型。',
  },
  {
    value: 'native',
    label: '原生图片',
    description: '直接将图片发送给模型。需要模型和执行链路支持原生图片输入。',
  },
  {
    value: 'disabled',
    label: '关闭图片',
    description: '禁止发送图片。上传图片时会提示切换模式。',
  },
];

const DEEPSEEK_ASSIST_OPTIONS: { value: DeepSeekImageAssist; label: string }[] = [
  { value: 'auto', label: '自动判断' },
  { value: 'on', label: '开启' },
  { value: 'off', label: '关闭' },
];

interface VisionSettingsTabProps {
  provider?: string;
  sessionId?: string | null;
  executor?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  modelAlias?: string | null;
  onModeChanged?: (mode: ImageProcessingMode) => void;
}

export default function VisionSettingsTab({
  provider,
  sessionId,
  executor,
  modelId,
  modelName,
  modelAlias,
  onModeChanged,
}: VisionSettingsTabProps) {
  const { effectiveConfig, loading, setMode, setDeepSeekAssist, refreshStatus } = useVisionSettings({
    provider,
    sessionId,
    executor,
    modelId,
    modelName,
    modelAlias,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<{
    configured: boolean;
    healthy: boolean;
    providerInfo: Record<string, unknown> | null;
  } | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/vision/status');
      if (res.ok) {
        const data = await res.json();
        setHealthStatus(data?.data || null);
      }
    } catch {
      // Health check is best-effort
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const handleModeChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const mode = event.target.value as ImageProcessingMode;
      setSaving(true);
      setSaveError(null);
      try {
        await setMode(mode, sessionId);
        onModeChanged?.(mode);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [setMode, sessionId, onModeChanged],
  );

  const handleDeepSeekAssistChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value as DeepSeekImageAssist;
      if (!sessionId) return;
      setSaving(true);
      setSaveError(null);
      try {
        await setDeepSeekAssist(value, sessionId);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [setDeepSeekAssist, sessionId],
  );

  if (loading || !effectiveConfig) {
    return (
      <SettingsSection
        title="图片处理"
        description="加载中..."
      >
        <div className="animate-pulse space-y-3">
          <div className="h-10 w-full rounded-lg bg-muted" />
          <div className="h-10 w-full rounded-lg bg-muted" />
        </div>
      </SettingsSection>
    );
  }

  const currentMode = effectiveConfig.mode;
  const strategy = effectiveConfig.effectiveStrategy;
  const modelIdentity = effectiveConfig.modelIdentity;

  const strategyLabel = (() => {
    switch (strategy) {
      case 'passthrough':
        return '原生发送';
      case 'vision-proxy':
        return '视觉代理';
      case 'blocked':
        return '已关闭';
    }
  })();

  // Determine the contextual description based on model identity
  const contextualDescription = (() => {
    if (!modelIdentity) {
      return currentMode === 'auto_deepseek'
        ? '当前策略：不自动使用视觉代理。可手动为当前会话开启图片辅助。'
        : undefined;
    }

    const isDeepSeek = modelIdentity.provider === 'deepseek' && modelIdentity.nativeVision === 'unsupported';
    const hasNativeVision = modelIdentity.nativeVision === 'supported';
    const isUnknown = modelIdentity.provider === 'unknown' || modelIdentity.nativeVision === 'unknown';

    if (currentMode === 'auto_deepseek') {
      if (isDeepSeek) {
        return '当前策略：使用图片辅助。说明：仅在发送图片时调用视觉模型。';
      }
      if (hasNativeVision) {
        return '当前策略：沿用模型原生图片能力。说明：不会调用视觉代理。';
      }
      if (isUnknown) {
        return '当前策略：不自动使用视觉代理。说明：可手动为当前会话开启图片辅助。';
      }
    }

    // For other modes, show the modal strategy description
    if (currentMode === 'proxy') {
      return '当前策略：始终使用视觉代理。有图片时调用视觉模型分析。';
    }
    if (currentMode === 'native') {
      return '当前策略：直接发送图片到模型。不经过视觉代理。';
    }
    if (currentMode === 'disabled') {
      return '当前策略：禁止图片处理。上传图片时会被拦截。';
    }

    return undefined;
  })();

  const currentModeOption = MODE_OPTIONS.find((o) => o.value === currentMode);

  return (
    <div className="space-y-8">
      {/* Mode Selector */}
      <SettingsSection
        title="图片处理方式"
        description="控制聊天中图片的处理方式。默认为：仅为 DeepSeek 纯文本模型提供图片辅助，其他模型沿用原生能力。"
      >
        <SettingsCard>
          <SettingsRow
            label="图片处理方式"
            description={currentModeOption?.description || ''}
          >
            <select
              value={currentMode}
              onChange={handleModeChange}
              disabled={saving}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-44"
            >
              {MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingsRow>
        </SettingsCard>
        {saveError && (
          <p className="mt-2 text-sm text-red-500">{saveError}</p>
        )}
        {saving && (
          <p className="mt-2 text-sm text-muted-foreground">保存中...</p>
        )}
      </SettingsSection>

      {/* Session-level DeepSeek Image Assist Toggle */}
      {sessionId && (
        <SettingsSection
          title="当前会话 DeepSeek 图片辅助"
          description="手动覆盖当前会话的 DeepSeek 图片辅助行为。选择「开启」时，有图片会走视觉代理；选择「关闭」时，不走视觉代理。"
        >
          <SettingsCard>
            <SettingsRow
              label="DeepSeek 图片辅助"
              description={
                effectiveConfig.deepseekImageAssist === 'auto'
                  ? '自动判断：根据模型身份自动决定是否使用图片辅助。'
                  : effectiveConfig.deepseekImageAssist === 'on'
                    ? '已开启：当前会话有图片时将使用视觉代理。纯文字不调用视觉服务。'
                    : '已关闭：当前会话不使用视觉代理，图片直接发送。'
              }
            >
              <select
                value={effectiveConfig.deepseekImageAssist}
                onChange={handleDeepSeekAssistChange}
                disabled={saving}
                className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
              >
                {DEEPSEEK_ASSIST_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Current Strategy */}
      <SettingsSection
        title="当前策略"
        description="当前会话的图片处理策略说明。"
      >
        <SettingsCard>
          <div className="divide-y divide-border px-4">
            <StatusRow
              label="图片处理"
              value={`${currentModeOption?.label || currentMode}（${strategyLabel}）`}
            />
            {contextualDescription && (
              <StatusRow
                label="策略说明"
                value={contextualDescription}
              />
            )}
            <StatusRow
              label="设置来源"
              value={
                effectiveConfig.source === 'session'
                  ? '会话设置'
                  : '全局设置'
              }
            />
            <StatusRow
              label="原生图片支持"
              value={
                effectiveConfig.nativeImageSupport === 'supported'
                  ? '支持'
                  : effectiveConfig.nativeImageSupport === 'unsupported'
                    ? '不支持（DeepSeek 纯文本）'
                    : '未知'
              }
            />
            <StatusRow
              label="视觉服务"
              value={
                effectiveConfig.visionConfigured
                  ? '已配置'
                  : '未配置'
              }
            />
            {modelIdentity && (
              <>
                <StatusRow
                  label="识别模型"
                  value={modelIdentity.modelId || modelIdentity.provider}
                />
                <StatusRow
                  label="识别来源"
                  value={modelIdentity.matchDetail}
                />
              </>
            )}
            {healthStatus && (
              <StatusRow
                label="服务健康"
                value={
                  healthStatus.healthy
                    ? '正常'
                    : '异常'
                }
              />
            )}
            {healthStatus?.providerInfo && (
              <StatusRow
                label="视觉模型"
                value={String((healthStatus.providerInfo as Record<string, unknown>).configuredModel || '-')}
              />
            )}
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* Actions */}
      <SettingsSection title="操作">
        <button
          type="button"
          onClick={refreshStatus}
          className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
        >
          刷新状态
        </button>
      </SettingsSection>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
