import { Check, Loader2 } from "lucide-react";
import { WorkflowMarkdownContent } from "../../";
import { WorkflowDetailCopyButton } from "../DetailCopyButton";
import type {
  ImageGenerationDetailData,
  PlanStep,
  ToolSearchDetailData,
  UsageDetailData,
  WebSearchDetailData,
} from "./types";
import {
  formatBytes,
  formatCompactNumber,
  formatPercent,
  planStatusLabel,
  planStatusTone,
} from "./helpers";

export function ToolSearchDetail({ data }: { data: ToolSearchDetailData }) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-label">Query</div>
      <div className="workflow-tool-primary">{data.query || "tools"}</div>
      {data.limit ? (
        <div className="workflow-tool-muted">Limit {data.limit}</div>
      ) : null}
      {data.tools.length ? (
        <div className="workflow-tool-chips">
          {data.tools.map((tool) => (
            <span key={tool} className="workflow-tool-chip">
              {tool}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WebSearchDetail({ data }: { data: WebSearchDetailData }) {
  const primary = data.url || data.query || data.queries[0] || "web";

  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-label">
        {data.type === "open_page" ? "Open page" : "Search"}
      </div>
      <div className="workflow-tool-primary">{primary}</div>
      {data.queries.length > 1 ? (
        <div className="workflow-tool-list">
          {data.queries.map((query) => (
            <div key={query}>{query}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ImageGenerationDetail({
  data,
  completed,
}: {
  data: ImageGenerationDetailData;
  completed: boolean;
}) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-primary">
        {data.hasResult || completed ? "Image generated" : "Generating image"}
      </div>
      <div className="workflow-tool-muted">
        {[data.status, data.resultBytes ? formatBytes(data.resultBytes) : ""]
          .filter(Boolean)
          .join(" / ")}
      </div>
      {data.prompt ? (
        <pre className="workflow-tool-pre">{data.prompt}</pre>
      ) : null}
    </div>
  );
}

export function PlanDetail({ steps }: { steps: PlanStep[] }) {
  return (
    <div className="workflow-tool-plan">
      {steps.map((step, index) => (
        <div
          key={`${step.status}-${step.step}-${index}`}
          className="workflow-tool-plan-row"
        >
          <span
            className={`workflow-tool-plan-dot ${planStatusTone(step.status)}`}
          >
            {step.status === "completed" ? (
              <Check />
            ) : step.status === "in_progress" ? (
              <Loader2 />
            ) : (
              <span />
            )}
          </span>
          <div className="workflow-tool-plan-content">
            <div className="workflow-tool-plan-step">{step.step}</div>
            <div className="workflow-tool-muted">
              {planStatusLabel(step.status)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MarkdownDetail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-label">{label}</div>
      <div className="workflow-tool-markdown">
        <WorkflowMarkdownContent content={value} />
      </div>
    </div>
  );
}

export function UsageDetail({ data }: { data: UsageDetailData }) {
  const ratePercent = Math.max(
    data.primaryPercent ?? 0,
    data.secondaryPercent ?? 0,
  );

  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-metrics">
        <UsageMetric
          label="total"
          value={formatCompactNumber(data.totalTokens)}
        />
        <UsageMetric
          label="last"
          value={formatCompactNumber(data.lastTokens)}
        />
        <UsageMetric
          label="context"
          value={formatCompactNumber(data.contextWindow)}
        />
      </div>
      <div className="workflow-tool-usage-bar">
        <span
          style={{ width: `${Math.min(Math.max(ratePercent, 0), 100)}%` }}
        />
      </div>
      <div className="workflow-tool-muted">
        {[formatPercent(ratePercent), data.planType]
          .filter(Boolean)
          .join(" / ")}
      </div>
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="workflow-tool-metric">
      <div>{value}</div>
      <span>{label}</span>
    </div>
  );
}

export function DetailBlock({
  label,
  value,
  danger,
  scrollable,
}: {
  label: string;
  value: string;
  danger?: boolean;
  scrollable?: boolean;
}) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-section-head">
        <span className="workflow-tool-label">{label}</span>
        <WorkflowDetailCopyButton value={value} label={`复制${label}`} />
      </div>
      <pre
        className={`workflow-tool-pre ${danger ? "is-danger" : ""} ${scrollable ? "is-scrollable" : ""}`}
      >
        {value}
      </pre>
    </div>
  );
}
