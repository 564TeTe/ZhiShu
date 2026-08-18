import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeCheck,
  CircleHelp,
  Coins,
  Cpu,
  Gauge,
  Package,
  Search,
  Server,
  Sparkles,
  TerminalSquare,
  Timer,
  RefreshCw,
  X,
} from 'lucide-react';

import { Badge, Button, Dialog, DialogContent, DialogTitle, Input } from '../../../../shared/view/ui';
import type { LLMProvider, ProviderModelsCacheInfo, ProviderModelsDefinition } from '../../../../types/app';
import type {
  CommandModalPayload,
  CostCommandData,
  HelpCommandData,
  ModelCommandData,
  StatusCommandData,
} from '../../hooks/useChatComposerState';

type CommandResultModalProps = {
  payload: CommandModalPayload | null;
  onClose: () => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelCacheCatalog: Partial<Record<LLMProvider, ProviderModelsCacheInfo>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
  currentSessionId: string | null;
  onSelectProviderModel: (
    provider: LLMProvider,
    model: string,
    sessionId?: string | null,
  ) => Promise<{
    scope: 'default' | 'session';
    model: string;
  }>;
};

type CommandEntry = {
  name: string;
  description?: string;
  namespace?: string;
};

type ModelOption = {
  value: string;
  label?: string;
  description?: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
};

const FALLBACK_COMMANDS: CommandEntry[] = [
  { name: '/models', description: '浏览当前服务商的可用模型。' },
  { name: '/cost', description: '查看当前会话的 Token 用量。' },
  { name: '/status', description: '查看运行时、版本、服务商和环境状态。' },
  { name: '/memory', description: '打开项目的 CLAUDE.md 记忆文件。' },
  { name: '/config', description: '打开设置和配置面板。' },
  { name: '/help', description: '显示命令文档和语法说明。' },
];

const getProviderLabel = (provider: string | undefined, fallback = '未知') => {
  if (!provider) {
    return fallback;
  }

  return PROVIDER_LABELS[provider] || provider;
};

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString();
};

function MetricCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  compact = false,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  tone?: 'neutral' | 'primary' | 'success';
  compact?: boolean;
}) {
  const toneClass =
    tone === 'primary'
      ? 'border-primary/35 bg-primary/10 text-primary'
      : tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
        : 'border-border/70 bg-background/75 text-muted-foreground';

  return (
    <div
      className={`group rounded-2xl border border-border/70 bg-background/75 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className={`inline-flex rounded-xl border ${compact ? 'mb-2 p-1.5' : 'mb-3 p-2'} ${toneClass}`}>
        <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={`${compact ? 'mt-0.5 text-[13px]' : 'mt-1 text-sm'} break-all font-semibold text-foreground`}>{value}</p>
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 rounded-xl border-border/70 bg-background/75 pl-9 pr-3 shadow-none focus-visible:ring-primary/40"
      />
    </div>
  );
}

function HelpContent({ data }: { data: HelpCommandData }) {
  const [query, setQuery] = useState('');
  const commands = (Array.isArray(data.commands) && data.commands.length > 0
    ? data.commands
    : FALLBACK_COMMANDS) as CommandEntry[];

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return commands;
    }

    return commands.filter((command) => {
      const haystack = `${command.name} ${command.description || ''} ${command.namespace || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [commands, query]);

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-0 flex-col gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="搜索命令..." />

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2 sm:grid-cols-2">
            {filteredCommands.map((command, index) => (
              <div
                key={`${command.namespace || 'builtin'}-${command.name}`}
                className="settings-content-enter rounded-2xl border border-border/70 bg-background/75 p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-muted/25"
                style={{ animationDelay: `${Math.min(index * 18, 160)}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <code className="rounded-lg border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {command.name}
                  </code>
                  <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                    {command.namespace || 'builtin'}
                  </Badge>
                </div>
                <p className="mt-3 text-sm leading-5 text-muted-foreground">
                  {command.description || '暂无描述。'}
                </p>
              </div>
            ))}
          </div>

          {filteredCommands.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              没有匹配的命令。
            </div>
          )}
        </div>
      </div>

      <aside className="space-y-3">
        <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <TerminalSquare className="h-4 w-4 text-primary" />
            语法
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p><code className="text-foreground">/命令 参数1 参数2</code></p>
            <p><code className="text-foreground">$ARGUMENTS</code> 传递所有参数。</p>
            <p><code className="text-foreground">$1</code>、<code className="text-foreground">$2</code> 传递位置参数。</p>
            <p><code className="text-foreground">@文件</code> 包含文件内容。</p>
          </div>
        </div>

        <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Quick tip
          </div>
          <p className="text-sm leading-5 text-muted-foreground">
            Type <code className="text-foreground">/</code> in the composer to open the command palette, then use arrows and Enter to run a command.
          </p>
        </div>
      </aside>
    </div>
  );
}

function ModelsContent({
  data,
  providerModelCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
  currentSessionId,
  onSelectProviderModel,
}: {
  data: ModelCommandData;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelsRefreshing: boolean;
  onHardRefreshProviderModels: () => void;
  currentSessionId: string | null;
  onSelectProviderModel: CommandResultModalProps['onSelectProviderModel'];
}) {
  const [query, setQuery] = useState('');
  const [changingModel, setChangingModel] = useState<string | null>(null);
  const [pendingSessionModel, setPendingSessionModel] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const currentProvider = (data?.current?.provider || 'claude') as LLMProvider;
  const currentModel = data?.current?.model || 'Unknown';
  const providerLabel = data?.current?.providerLabel || getProviderLabel(currentProvider);
  const liveDefinition = providerModelCatalog[currentProvider];
  const availableOptions = useMemo<ModelOption[]>(() => {
    if (liveDefinition?.OPTIONS && liveDefinition.OPTIONS.length > 0) {
      return liveDefinition.OPTIONS;
    }

    if (Array.isArray(data?.availableOptions) && data.availableOptions.length > 0) {
      return data.availableOptions;
    }

    const availableModels = Array.isArray(data?.availableModels) ? data.availableModels : [];
    return availableModels.map((model) => ({ value: model, label: model }));
  }, [data, liveDefinition]);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return availableOptions;
    }

    return availableOptions.filter((option) => {
      const haystack = `${option.value} ${option.label || ''} ${option.description || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [availableOptions, query]);

  const hasConcreteSessionId = typeof currentSessionId === 'string' && currentSessionId.trim().length > 0;
  const showSearch = availableOptions.length > 6;

  const handleSelectModel = async (model: string) => {
    setChangingModel(model);
    try {
      const result = await onSelectProviderModel(currentProvider, model, currentSessionId);
      if (result.scope === 'session') {
        setPendingSessionModel(result.model);
        setSelectionNotice(`当前会话已切换至 ${result.model}。`);
        return;
      }

      setPendingSessionModel(null);
      setSelectionNotice(`已将 ${providerLabel} 默认模型设为 ${result.model}。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '暂时无法切换模型。';
      setSelectionNotice(message);
    } finally {
      setChangingModel(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Compact context bar: active model + refresh, no clutter */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            当前模型 · {providerLabel}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-all font-mono text-sm font-semibold text-foreground">{currentModel}</span>
            {pendingSessionModel && pendingSessionModel !== currentModel && (
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-500 dark:text-emerald-400">
                → 下次会话: {pendingSessionModel}
              </span>
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onHardRefreshProviderModels}
          disabled={providerModelsRefreshing}
          title="刷新模型列表"
          aria-label="刷新模型列表"
          className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={`h-4 w-4 ${providerModelsRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {showSearch && (
        <SearchField value={query} onChange={setQuery} placeholder={`搜索 ${providerLabel} 模型...`} />
      )}

      {filteredOptions.length > 0 ? (
        <div className="scrollbar-thin -mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid gap-2 md:grid-cols-2">
            {filteredOptions.map((option, index) => {
              const isCurrent = option.value === currentModel;
              const isPendingSelection = option.value === pendingSessionModel;
              const isChanging = option.value === changingModel;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelectModel(option.value)}
                  disabled={Boolean(changingModel)}
                  aria-label={`选择模型 ${option.value}`}
                  className={`settings-content-enter group flex min-h-16 flex-col rounded-2xl border p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 ${
                    isCurrent
                      ? 'border-primary/45 bg-primary/10'
                      : isPendingSelection
                        ? 'border-emerald-500/35 bg-emerald-500/10'
                        : 'border-border/70 bg-background/80 hover:border-primary/30 hover:bg-background'
                  }`}
                  style={{ animationDelay: `${Math.min(index * 14, 180)}ms` }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="break-all font-mono text-sm font-semibold text-foreground">{option.value}</span>
                    {isCurrent ? (
                      <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                    ) : isChanging ? (
                      <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    ) : null}
                  </span>
                  {option.label && option.label !== option.value && (
                    <span className="mt-1 text-xs font-medium text-foreground/85">{option.label}</span>
                  )}
                  {option.description && (
                    <span className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</span>
                  )}
                  {isCurrent && (
                    <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">当前选择</span>
                  )}
                  {isPendingSelection && !isCurrent && (
                    <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-500 dark:text-emerald-400">
                      本会话模型
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-10 text-center text-sm text-muted-foreground">
          没有匹配的模型。
        </div>
      )}

      {/* Single quiet line of guidance / feedback */}
      <p className="shrink-0 text-[11px] leading-4 text-muted-foreground">
        {selectionNotice ? (
          <span className="text-foreground">{selectionNotice}</span>
        ) : hasConcreteSessionId ? (
          '你的选择将保存到当前会话，并成为新聊天的默认值。'
        ) : (
          '你的选择将成为新聊天的默认模型。'
        )}
      </p>
    </div>
  );
}

function CostContent({ data }: { data: CostCommandData }) {
  const used = Number(data.tokenUsage?.used ?? 0);
  const total = Number(data.tokenUsage?.total ?? 0);
  const model = data.model || '未知';
  const provider = data.provider || '未知';
  const hasBreakdown =
    typeof data.tokenBreakdown?.input === 'number' ||
    typeof data.tokenBreakdown?.output === 'number';
  const inputTokens = Number(data.tokenBreakdown?.input ?? 0);
  const outputTokens = Number(data.tokenBreakdown?.output ?? 0);
  const usageRatio = total > 0 ? Math.min(used / total, 1) : 0;

  const usageRows = [
    { label: '已用 Token', value: formatNumber(used), icon: Activity },
    ...(hasBreakdown
      ? [
          {
            label: '输入 Token',
            value: formatNumber(inputTokens),
            icon: ArrowDownToLine,
          },
          {
            label: '输出 Token',
            value: formatNumber(outputTokens),
            icon: ArrowUpFromLine,
          },
        ]
      : []),
    ...(total > 0
      ? [{ label: '上下文窗口', value: formatNumber(total), icon: Gauge }]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Context window usage bar */}
      {total > 0 && (
        <div className="rounded-2xl border border-border/70 bg-background/75 p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">上下文窗口用量</span>
            <span className="font-mono font-semibold text-foreground">
              {formatNumber(used)} / {formatNumber(total)}
              <span className="ml-1 text-muted-foreground">({Math.round(usageRatio * 100)}%)</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
              style={{ width: `${Math.round(usageRatio * 100)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              输入 {formatNumber(inputTokens)}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              输出 {formatNumber(outputTokens)}
            </span>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/75">
        {usageRows.map((row) => {
          const Icon = row.icon;

          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">服务商</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{provider}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">模型</p>
            <p className="mt-1 break-all font-mono text-sm text-foreground">{model}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusContent({ data }: { data: StatusCommandData }) {
  const memoryRssMb = data.memoryUsage?.rssMb;
  const rows = [
    { label: '包名', value: data.packageName || 'cloudcli', icon: Package },
    { label: '版本', value: data.version || '未知', icon: BadgeCheck, tone: 'success' as const },
    { label: '运行时间', value: data.uptime || '未知', icon: Timer },
    { label: '服务商', value: data.provider || '未知', icon: Server, tone: 'primary' as const },
    { label: '模型', value: data.model || '未知', icon: Cpu },
    { label: 'Node.js', value: data.nodeVersion || '未知', icon: TerminalSquare },
    { label: '平台', value: data.platform || '未知', icon: Activity },
    { label: '内存', value: typeof memoryRssMb === 'number' ? `${memoryRssMb} MB RSS` : '未知', icon: Gauge },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-3xl border border-emerald-500/25 bg-emerald-500/10 p-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">运行中</p>
            <p className="text-xs text-muted-foreground">进程 {data.pid ? `#${data.pid}` : '状态'} 正常响应。</p>
          </div>
        </div>
        <Badge className="rounded-full bg-emerald-500 text-white hover:bg-emerald-500">健康</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((row) => (
          <MetricCard key={row.label} label={row.label} value={String(row.value)} icon={row.icon} tone={row.tone} />
        ))}
      </div>
    </div>
  );
}

export default function CommandResultModal({
  payload,
  onClose,
  providerModelCatalog,
  providerModelsRefreshing,
  onHardRefreshProviderModels,
  currentSessionId,
  onSelectProviderModel,
}: CommandResultModalProps) {
  const isOpen = Boolean(payload);
  const kind = payload?.kind;
  const isModelsModal = kind === 'models';

  const modalMeta = {
    help: {
      eyebrow: '命令中心',
      title: '帮助与快捷键',
      subtitle: '无需离开聊天即可搜索内置命令、语法模式和命令用法。',
      icon: CircleHelp,
    },
    models: {
      eyebrow: '模型选择',
      title: '选择模型',
      subtitle: '选择当前服务商使用的模型。',
      icon: Cpu,
    },
    cost: {
      eyebrow: '会话用量',
      title: 'Token 用量',
      subtitle: '查看当前会话的输入、输出和总 Token 消耗。',
      icon: Coins,
    },
    status: {
      eyebrow: '运行状态',
      title: '系统状态',
      subtitle: '版本、服务商、运行时和环境详情一览。',
      icon: Activity,
    },
  } as const;

  const activeMeta = kind ? modalMeta[kind] : null;
  const HeaderIcon = activeMeta?.icon || Sparkles;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(92dvh,48rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden rounded-3xl border-border/80 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl sm:w-[min(94vw,64rem)]">
        <DialogTitle>{activeMeta?.title || 'Command Result'}</DialogTitle>

        <div
          className={`flex shrink-0 items-start justify-between gap-3 border-b border-border bg-popover ${
            isModelsModal ? 'px-4 py-3 sm:px-5 sm:py-4' : 'px-4 py-4 sm:px-6 sm:py-5'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-foreground ${
                isModelsModal ? 'h-9 w-9' : 'h-10 w-10'
              }`}
            >
              <HeaderIcon className={isModelsModal ? 'h-4 w-4' : 'h-5 w-5'} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {activeMeta?.eyebrow}
              </p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                {activeMeta?.title}
              </p>
              <p className="mt-0.5 max-w-2xl text-sm leading-5 text-muted-foreground">
                {activeMeta?.subtitle}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close command result modal"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="settings-content-enter min-h-0 flex-1 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
          {payload?.kind === 'help' && <HelpContent data={payload.data as HelpCommandData} />}
          {payload?.kind === 'models' && (
            <ModelsContent
              data={payload.data as ModelCommandData}
              providerModelCatalog={providerModelCatalog}
              providerModelsRefreshing={providerModelsRefreshing}
              onHardRefreshProviderModels={onHardRefreshProviderModels}
              currentSessionId={currentSessionId}
              onSelectProviderModel={onSelectProviderModel}
            />
          )}
          {payload?.kind === 'cost' && <CostContent data={payload.data as CostCommandData} />}
          {payload?.kind === 'status' && <StatusContent data={payload.data as StatusCommandData} />}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-border/70 bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5" />
            <span>Esc closes the modal.</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-xl">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
