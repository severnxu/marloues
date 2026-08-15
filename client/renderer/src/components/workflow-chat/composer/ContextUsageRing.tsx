import type { ContextUsageRecord, TokenUsage } from "@shared/types";

interface Props {
  snapshot: ContextUsageRecord;
  usage?: TokenUsage;
  size?: number;
}

export function ContextUsageRing({ snapshot, usage, size = 14 }: Props) {
  const totalTokens = snapshot.totalTokens;
  const maxTokens = usage?.modelContextWindowTokens ?? snapshot.maxTokens;
  const percentage =
    totalTokens !== undefined && maxTokens !== undefined && maxTokens > 0
      ? Math.min(100, (totalTokens / maxTokens) * 100)
      : snapshot.percentage;
  if (percentage === undefined) return null;

  const pct = Math.round(percentage);
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(100, pct) / 100);
  const level = pct >= 95 ? "critical" : pct >= 80 ? "warning" : "ok";

  return (
    <span
      style={{ width: size, height: size }}
      className={`context-usage-ring level-${level}`}
      tabIndex={0}
      aria-label={`上下文用量 ${pct}%`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 12 12"
        className="ring-rotate"
        aria-hidden="true"
      >
        <circle
          cx="6"
          cy="6"
          r={radius}
          fill="none"
          strokeWidth="2"
          className="ring-track"
        />
        <circle
          cx="6"
          cy="6"
          r={radius}
          fill="none"
          strokeWidth="2"
          className="ring-progress"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
      <span className="context-usage-tooltip">
        <span className="context-usage-tooltip-title">
          Token 用量(已用上下文)
        </span>
        <span
          className="context-usage-tooltip-progress-track"
          role="progressbar"
          aria-label="上下文用量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <span
            className="context-usage-tooltip-progress-fill"
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </span>
        <span className="context-usage-tooltip-summary">
          <span>已使用 / 限额</span>
          <strong>{formatContextValue(totalTokens, maxTokens, pct)}</strong>
        </span>
        <span className="context-usage-tooltip-rows">
          <TokenDetailRow label="输入" value={usage?.inputTokens} />
          <TokenDetailRow label="输出" value={usage?.outputTokens} />
          <TokenDetailRow
            label="缓存读取"
            value={usage?.cacheReadInputTokens}
          />
          <TokenDetailRow
            label="缓存写入"
            value={usage?.cacheCreationInputTokens}
          />
        </span>
      </span>
    </span>
  );
}

function TokenDetailRow({ label, value }: { label: string; value?: number }) {
  return (
    <span className="context-usage-tooltip-row">
      <span>{label}</span>
      <strong>{formatDetailedTokens(value)}</strong>
    </span>
  );
}

function formatContextValue(
  totalTokens: number | undefined,
  maxTokens: number | undefined,
  percentage: number,
): string {
  if (totalTokens === undefined || maxTokens === undefined) {
    return `${percentage}%`;
  }
  return `${formatCompactTokens(totalTokens)} / ${formatCompactTokens(maxTokens)}`;
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${formatCompactNumber(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${formatCompactNumber(tokens / 1_000)}K`;
  return String(Math.max(0, Math.round(tokens)));
}

function formatCompactNumber(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatDetailedTokens(tokens: number | undefined): string {
  if (tokens === undefined) return "—";
  return formatCompactTokens(Math.max(0, Math.round(tokens)));
}
