import { ArrowDownToLine, ArrowUpFromLine, ActivityIcon } from 'lucide-react';

type TokenUsageSummaryProps = {
  usage: Record<string, unknown> | null;
  onClick?: () => void;
};

const formatTokenCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 10_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return value.toLocaleString();
};

const readUsageNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Compact token usage badge shown in the chat composer toolbar.
 *
 * Shows:
 *  - Total tokens used (always)
 *  - Input / Output split as a compact hover tooltip or inline
 *  - Context window progress bar when total is available
 */
export default function TokenUsageSummary({ usage, onClick }: TokenUsageSummaryProps) {
  const breakdown =
    usage?.breakdown && typeof usage.breakdown === 'object'
      ? usage.breakdown as Record<string, unknown>
      : null;
  const inputTokens = readUsageNumber(usage?.inputTokens ?? breakdown?.input);
  const outputTokens = readUsageNumber(usage?.outputTokens ?? breakdown?.output);
  const usedTokens = readUsageNumber(usage?.used) || inputTokens + outputTokens;
  const contextTotal = readUsageNumber(usage?.total);
  const usageRatio = contextTotal > 0 ? Math.min(usedTokens / contextTotal, 1) : 0;

  // Build a descriptive tooltip
  const tooltipLines: string[] = [];
  if (usedTokens > 0) tooltipLines.push(`已用：${usedTokens.toLocaleString()} tokens`);
  if (inputTokens > 0) tooltipLines.push(`输入：${inputTokens.toLocaleString()} tokens`);
  if (outputTokens > 0) tooltipLines.push(`输出：${outputTokens.toLocaleString()} tokens`);
  if (contextTotal > 0) {
    tooltipLines.push(`上下文窗口：${contextTotal.toLocaleString()} tokens`);
    tooltipLines.push(`使用率：${Math.round(usageRatio * 100)}%`);
  }

  const hasSplit = inputTokens > 0 || outputTokens > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 text-xs text-muted-foreground shadow-sm transition-all hover:border-primary/25 hover:text-foreground hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5"
      title={tooltipLines.join('\n')}
      aria-label="查看 Token 用量详情"
    >
      {/* Context window mini progress bar (only when context total known) */}
      {contextTotal > 0 && (
        <span className="absolute inset-x-1 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-muted">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-primary/50 transition-all"
            style={{ width: `${Math.round(usageRatio * 100)}%` }}
          />
        </span>
      )}

      <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/10 text-primary">
        <ActivityIcon className="h-3.5 w-3.5" />
      </span>

      {/* Total tokens */}
      <span className="font-semibold tabular-nums text-foreground">
        {formatTokenCount(usedTokens)}
      </span>

      {/* Input/Output split — compact inline */}
      {hasSplit && (
        <span className="hidden items-center gap-1 text-[10px] text-muted-foreground/70 sm:flex">
          <span className="flex items-center gap-0.5">
            <ArrowDownToLine className="h-2.5 w-2.5 text-blue-500" />
            {formatTokenCount(inputTokens)}
          </span>
          <ArrowUpFromLine className="h-2.5 w-2.5 text-emerald-500" />
          {formatTokenCount(outputTokens)}
        </span>
      )}

      {/* Context window usage ratio (compact) */}
      {contextTotal > 0 && (
        <span className="hidden text-[10px] text-muted-foreground/60 sm:inline">
          {Math.round(usageRatio * 100)}%
        </span>
      )}
    </button>
  );
}
