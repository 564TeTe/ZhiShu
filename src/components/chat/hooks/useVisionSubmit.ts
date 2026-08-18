/**
 * Vision-aware message submission handler.
 *
 * Replaces the inline vision processing block in useChatComposerState.handleSubmit.
 *
 * Key design:
 *  1. Strategy is determined FIRST (fast config fetch).
 *  2. Optimistic user message is inserted IMMEDIATELY — never blocked on vision API.
 *  3. Vision analysis runs AFTER the message is visible.
 *  4. Enriched prompt is sent to agent via WebSocket; visible content stays original.
 *  5. clientMessageId prevents duplicates.
 *
 * CRITICAL RULES (auto_deepseek mode):
 *  - NO images → vision code path is NEVER entered.
 *  - Unknown model → passthrough (NOT vision-proxy).
 *  - Only confirmed DeepSeek text-only models trigger vision proxy.
 *  - Text-only follow-ups do NOT re-analyze images.
 */

import { authenticatedFetch } from '../../../utils/api';
import { analyzeImage, formatAnalysisAsText } from '../utils/visionAnalyzer';
import type { ChatAttachment, ChatMessage } from '../types/types';
import type { ImageProcessingConfig, ImageProcessingMode } from '../../../types/vision';

export interface VisionSubmitContext {
  messageContent: string;
  imageFiles: File[];
  nonImageFiles: File[];
  provider: string;
  sessionKey: string | null;
  selectedProject: { fullPath?: string; path?: string; projectId?: string };
  sendMessage: (msg: unknown) => void;
  addMessage: (msg: ChatMessage) => void;
  onSessionProcessing?: (sessionId: string, opts: { statusText: string | null; canInterrupt: boolean }) => void;
  scrollToBottom: () => void;
  setIsUserScrolledUp: (v: boolean) => void;
  buildSendOptions: (input: string) => Record<string, unknown>;
  uploadAttachmentFiles: (files: File[]) => Promise<unknown[]>;
  selectedSession: { id?: string } | null;
  currentSessionId: string | null;
   
  onSessionEstablished?: (...args: any[]) => void;
  previouslyUploadedAttachments: unknown[];
  isImageAttachment: (a: ChatAttachment) => boolean;
  /** Model-level params for identity resolution (cached per session). */
  executor?: string | null;
  modelId?: string | null;
  modelName?: string | null;
  modelAlias?: string | null;
}

/** Align with computeStrategy in useVisionSettings.ts */
function computeEffectiveStrategy(
  mode: ImageProcessingMode,
  visionConfigured: boolean,
  nativeImageSupport: 'supported' | 'unsupported' | 'unknown',
): 'passthrough' | 'vision-proxy' | 'blocked' {
  switch (mode) {
    case 'native':
      return 'passthrough';
    case 'proxy':
      return visionConfigured ? 'vision-proxy' : 'blocked';
    case 'disabled':
      return 'blocked';
    case 'auto_deepseek':
    default:
      if (nativeImageSupport === 'supported') return 'passthrough';
      if (nativeImageSupport === 'unsupported') return visionConfigured ? 'vision-proxy' : 'blocked';
      // UNKNOWN → passthrough (DO NOT proxy)
      return 'passthrough';
  }
}

/** Returns { effectiveStrategy, config } or 'blocked'. */
async function resolveStrategy(
  provider: string,
  sessionKey: string | null,
  modelParams?: {
    executor?: string | null;
    modelId?: string | null;
    modelName?: string | null;
    modelAlias?: string | null;
  },
): Promise<{ effectiveStrategy: 'passthrough' | 'vision-proxy'; config: ImageProcessingConfig } | 'blocked'> {
  const modeParams = new URLSearchParams();
  if (sessionKey) modeParams.set('sessionId', sessionKey);

  const statusParams = new URLSearchParams();
  statusParams.set('provider', provider);
  if (modelParams?.executor) statusParams.set('executor', modelParams.executor);
  if (modelParams?.modelId) statusParams.set('modelId', modelParams.modelId);
  if (modelParams?.modelName) statusParams.set('modelName', modelParams.modelName);
  if (modelParams?.modelAlias) statusParams.set('modelAlias', modelParams.modelAlias);
  if (sessionKey) statusParams.set('sessionId', sessionKey);

  const [modeRes, statusRes] = await Promise.all([
    authenticatedFetch(`/api/settings/vision/mode?${modeParams.toString()}`),
    authenticatedFetch(`/api/settings/vision/status?${statusParams.toString()}`),
  ]);
  if (!modeRes.ok || !statusRes.ok) {
    throw new Error('Failed to fetch vision config');
  }

  const modeData = await modeRes.json();
  const statusData = await statusRes.json();
  const visionConfigured = statusData?.visionConfigured ?? false;
  const nativeSupport = statusData?.nativeImageSupport ?? 'unknown';
  const mode = (modeData?.mode as ImageProcessingMode) || 'auto_deepseek';

  const effectiveStrategy = computeEffectiveStrategy(mode, visionConfigured, nativeSupport);

  if (effectiveStrategy === 'blocked') return 'blocked';

  return {
    effectiveStrategy,
    config: {
      mode,
      source: modeData?.source || 'global',
      visionConfigured,
      nativeImageSupport: nativeSupport,
      effectiveStrategy,
      reason: '',
      modelIdentity: statusData?.modelIdentity,
      deepseekImageAssist: modeData?.deepseekImageAssist || 'auto',
    },
  };
}

/** Main entry point: handles vision-aware message submission. */
export async function submitWithVision(ctx: VisionSubmitContext): Promise<void> {
  const {
    messageContent, imageFiles, nonImageFiles, provider, sessionKey,
    selectedProject, sendMessage, addMessage, onSessionProcessing,
    scrollToBottom, setIsUserScrolledUp, buildSendOptions,
    uploadAttachmentFiles, selectedSession, currentSessionId,
    onSessionEstablished, previouslyUploadedAttachments, isImageAttachment,
    executor, modelId, modelName, modelAlias,
  } = ctx;

  const clientMessageId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // 1. Resolve strategy (only when there are images)
  // No images → completely skip vision code path.
  let effectiveStrategy: 'passthrough' | 'vision-proxy' = 'passthrough';
  if (imageFiles.length > 0) {
    const result = await resolveStrategy(provider, sessionKey, {
      executor, modelId, modelName, modelAlias,
    }).catch(() => 'blocked' as const);

    if (result === 'blocked') {
      // Provide a clear Chinese message when blocked.
      addMessage({
        type: 'error',
        content: '当前会话已关闭图片处理，请切换为自动（仅 DeepSeek）、强制视觉代理或原生图片。',
        timestamp: new Date(),
      });
      return;
    }
    effectiveStrategy = result.effectiveStrategy;
  }

  // 2. Session allocation
  const resolvedProjectPath = selectedProject.fullPath || selectedProject.path || '';
  let targetSessionId = selectedSession?.id || currentSessionId || null;
  if (!targetSessionId) {
    const resp = await authenticatedFetch('/api/providers/sessions', {
      method: 'POST',
      body: JSON.stringify({ provider, projectPath: resolvedProjectPath }),
    });
    if (!resp.ok) {
      addMessage({ type: 'error', content: 'Failed to create session.', timestamp: new Date() });
      return;
    }
    const body = await resp.json();
    targetSessionId = body?.data?.sessionId || null;
    if (!targetSessionId) {
      addMessage({ type: 'error', content: 'No session id returned.', timestamp: new Date() });
      return;
    }
    onSessionEstablished?.(targetSessionId, { provider, project: selectedProject });
  }

  // 3. File upload (non-image files, or all for native)
  const useVisionProxy = effectiveStrategy === 'vision-proxy' && imageFiles.length > 0;
  const filesToUpload = useVisionProxy ? nonImageFiles : [...imageFiles, ...nonImageFiles];
  let uploaded = previouslyUploadedAttachments;
  if (uploaded.length === 0 && filesToUpload.length > 0) {
    uploaded = await uploadAttachmentFiles(filesToUpload);
  }

  // 4. Build user message — visible content = original text + thumbnails ONLY
  const attachmentRecords = uploaded as ChatAttachment[];
  // For vision-proxy, create object URLs so thumbnails display immediately
  const visionProxyImages = useVisionProxy
    ? imageFiles.map((f) => {
        let data: string | undefined;
        try { data = URL.createObjectURL(f); } catch { /* ignore */ }
        return { name: f.name, mimeType: f.type, size: f.size, data };
      })
    : [];
  const userMessage: ChatMessage = {
    type: 'user',
    content: messageContent,
    images: useVisionProxy
      ? visionProxyImages
      : attachmentRecords.filter(isImageAttachment),
    files: useVisionProxy
      ? attachmentRecords.filter((a) => !isImageAttachment(a))
      : attachmentRecords.filter((a) => !isImageAttachment(a)),
    timestamp: new Date(),
    _clientMessageId: clientMessageId,
    _visionStatus: useVisionProxy ? 'analyzing' : undefined,
  };

  // 5. INSERT optimistic message IMMEDIATELY
  addMessage(userMessage);
  onSessionProcessing?.(targetSessionId, { statusText: null, canInterrupt: true });
  setIsUserScrolledUp(false);
  setTimeout(() => scrollToBottom(), 100);

  // 6. If vision proxy: run analysis, then send enriched prompt
  if (useVisionProxy) {
    try {
      const enrichedParts: string[] = [];
      const visionMeta: Record<string, unknown> = {};

      for (const imageFile of imageFiles) {
        const result = await analyzeImage({
          file: imageFile,
          question: messageContent || undefined,
          projectPath: resolvedProjectPath || undefined,
        });
        const enrichedText = formatAnalysisAsText(result.analysis, messageContent);
        enrichedParts.push(enrichedText);

        const simple = (result.analysis as unknown as Record<string, unknown>).simple as Record<string, unknown> | undefined;
        Object.assign(visionMeta, {
          cached: result.cached,
          provider: result.analysis.provider,
          model: result.analysis.model,
          latencyMs: result.analysis.latencyMs,
          imageType: simple?.imageType || 'other',
          description: simple?.description || result.analysis.summary,
          errorText: simple?.errorText || [],
          keyText: simple?.keyText || result.analysis.visibleText || [],
        });
      }

      // Build vision context (hidden from UI, only for agent)
      // Only pass concise results: description, errorText, keyText
      const visionContext = enrichedParts.join('\n\n---\n\n');
      userMessage._visionStatus = 'analyzed';
      userMessage._visionResult = visionMeta;
      // Upsert replaces the optimistic message (same _clientMessageId)
      addMessage({ ...userMessage, _clientMessageId: clientMessageId, timestamp: new Date() });

      const proxyAttachments = (uploaded as ChatAttachment[]).filter((a) => !isImageAttachment(a));
      // Send ORIGINAL text as content; vision analysis goes in options._visionContext
      // Server merges _visionContext into the agent prompt, keeping the transcript clean
      sendMessage({
        type: 'chat.send',
        sessionId: targetSessionId,
        content: messageContent,
        options: {
          ...buildSendOptions(messageContent),
          attachments: proxyAttachments,
          _clientMessageId: clientMessageId,
          _visionContext: visionContext,
          _isVisionEnriched: true,
        },
      });
    } catch (err) {
      userMessage._visionStatus = 'analysis_failed';
      userMessage._visionError = err instanceof Error ? err.message : String(err);
      addMessage({ ...userMessage, _clientMessageId: clientMessageId, timestamp: new Date() });
    }
  } else {
    // 7. Native / no-image path: send immediately
    // No vision processing at all.
    const nativeAttachments = uploaded as ChatAttachment[];
    sendMessage({
      type: 'chat.send',
      sessionId: targetSessionId,
      content: messageContent,
      options: {
        ...buildSendOptions(messageContent),
        attachments: nativeAttachments,
        _clientMessageId: clientMessageId,
      },
    });
  }
}
