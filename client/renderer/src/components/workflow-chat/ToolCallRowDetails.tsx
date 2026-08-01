import { useState } from "react";
import {
  Check,
  Clipboard,
  Copy,
  FilePenLine,
  FileText,
  FolderTree,
  Gauge,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Search,
  Square,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { WorkflowMarkdownContent } from "./MarkdownContent";
import type { WorkflowTurnItem as WorkflowStreamItem } from "../../../../shared/adapters/workflow-messages-to-read-thread";
import { itemInputText, itemOutputText } from "./item-text";
import { workflowStatusIsRunning } from "./turn-collapse-rules";

type ToolCallRowItem = Extract<
  WorkflowStreamItem,
  {
    type:
      | "plan"
      | "mcpToolCall"
      | "dynamicToolCall"
      | "webSearch"
      | "imageGeneration";
  }
>;

type PlanStep = { step: string; status: string };
type ToolSearchDetailData = { query: string; limit?: number; tools: string[] };
type WebSearchDetailData = {
  type: string;
  query: string;
  url: string;
  queries: string[];
};
type ImageGenerationDetailData = {
  prompt: string;
  status: string;
  hasResult: boolean;
  resultBytes?: number;
};
type UsageDetailData = {
  totalTokens?: number;
  lastTokens?: number;
  contextWindow?: number;
  primaryPercent?: number;
  secondaryPercent?: number;
  planType?: string;
};

export function ToolDetail({
  item,
  failed,
  cancellable,
  isCancelling,
  onCancel,
}: {
  item: ToolCallRowItem;
  failed: boolean;
  cancellable: boolean;
  isCancelling: boolean;
  onCancel: () => void;
}) {
  const input = itemInputText(item);
  const outputText = itemOutputText(item);
  const output = cleanDetailOutput(outputText);
  const name = toolName(item);
  const exitCode = exitCodeFromOutput(outputText);
  const status = itemStatus(item);
  const planSteps = name === "update_plan" ? parsePlanSteps(input) : [];
  const planMarkdown =
    item.type === "plan"
      ? item.text
      : name === "plan_snapshot"
        ? outputText
        : "";
  const toolSearch = name.includes("tool_search")
    ? parseToolSearchDetail(input, output)
    : null;
  const webSearch =
    item.type === "webSearch" ? parseWebSearchDetail(input, output) : null;
  const imageGeneration =
    item.type === "imageGeneration"
      ? parseImageGenerationDetail(input, output)
      : null;
  const usage = name === "token_count" ? parseUsageDetail(output) : null;
  const showDefaultInput = Boolean(
    input &&
    !planSteps.length &&
    !planMarkdown &&
    !toolSearch &&
    !webSearch &&
    !imageGeneration &&
    !usage,
  );
  const showOutput = Boolean(
    output &&
    !(name === "update_plan" && output === "Plan updated") &&
    !planMarkdown &&
    !toolSearch &&
    !webSearch &&
    !imageGeneration &&
    !usage,
  );
  const running = workflowStatusIsRunning(status);
  const statusText = running
    ? "运行中"
    : failed
      ? "失败"
      : exitCode !== null
        ? `exit ${exitCode}`
        : "成功";

  return (
    <div className="workflow-tool-card">
      <div className="workflow-tool-card-title">
        <span className="min-w-0 truncate">{detailTitle(item)}</span>
        {cancellable ? (
          <button
            type="button"
            className="workflow-tool-cancel"
            disabled={isCancelling}
            onClick={(event) => {
              event.stopPropagation();
              onCancel();
            }}
          >
            <Square className="h-3 w-3" />
            {isCancelling ? "正在取消" : "取消工具"}
          </button>
        ) : null}
      </div>
      <div className="workflow-tool-card-body">
        {planSteps.length ? <PlanDetail steps={planSteps} /> : null}
        {planMarkdown ? (
          <MarkdownDetail label="Plan" value={planMarkdown} />
        ) : null}
        {toolSearch ? <ToolSearchDetail data={toolSearch} /> : null}
        {webSearch ? <WebSearchDetail data={webSearch} /> : null}
        {imageGeneration ? (
          <ImageGenerationDetail data={imageGeneration} />
        ) : null}
        {usage ? <UsageDetail data={usage} /> : null}
        {showDefaultInput ? (
          <DetailBlock label={detailInputLabel(item)} value={input} />
        ) : null}
        {showOutput ? (
          <DetailBlock
            label={failed ? "Error" : "Output"}
            value={output}
            danger={failed}
            scrollable
          />
        ) : null}
        {!planSteps.length &&
        !planMarkdown &&
        !toolSearch &&
        !webSearch &&
        !imageGeneration &&
        !usage &&
        !showDefaultInput &&
        !showOutput ? (
          <div className="workflow-tool-empty">无输出</div>
        ) : null}
      </div>
      <div className={`workflow-tool-status ${failed ? "danger" : ""}`}>
        {statusText}
      </div>
    </div>
  );
}

export function ToolIcon({ item }: { item: ToolCallRowItem }) {
  const name = toolName(item);
  if (name === "update_plan" || name.includes("todo"))
    return <ListChecks className="h-3.5 w-3.5 flex-shrink-0" />;
  if (name === "token_count")
    return <Gauge className="h-3.5 w-3.5 flex-shrink-0" />;
  if (item.type === "imageGeneration")
    return <ImageIcon className="h-3.5 w-3.5 flex-shrink-0" />;
  if (isReadToolName(name))
    return <FileText className="h-3.5 w-3.5 flex-shrink-0" />;
  if (isListToolName(name))
    return <FolderTree className="h-3.5 w-3.5 flex-shrink-0" />;
  if (isEditToolName(name))
    return <FilePenLine className="h-3.5 w-3.5 flex-shrink-0" />;
  if (item.type === "webSearch" || name === "js" || name.includes("web"))
    return <Search className="h-3.5 w-3.5 flex-shrink-0" />;
  if (isSearchToolName(name))
    return <Search className="h-3.5 w-3.5 flex-shrink-0" />;
  if (name.includes("shell") || name.includes("command") || name === "commands")
    return <SquareTerminal className="h-3.5 w-3.5 flex-shrink-0" />;
  if (name.includes("clipboard"))
    return <Clipboard className="h-3.5 w-3.5 flex-shrink-0" />;
  return <Wrench className="h-3.5 w-3.5 flex-shrink-0" />;
}

export function toolLabel(item: ToolCallRowItem): string {
  const codexLabel = codexStyleToolLabel(item);
  if (codexLabel) return codexLabel;
  const label = readableToolLabel(item);
  const status = itemStatus(item);
  if (workflowStatusIsRunning(status))
    return label.startsWith("已") ? label.replace(/^已/, "正在") : label;
  if (status === "error" || status === "failed")
    return label.startsWith("已")
      ? label.replace(/^已/, "失败：")
      : `失败：${label}`;
  return label;
}

function codexStyleToolLabel(item: ToolCallRowItem): string | null {
  const name = toolName(item);
  const status = itemStatus(item);
  const verb =
    status === "error" || status === "failed"
      ? "失败："
      : workflowStatusIsRunning(status)
        ? "正在运行 "
        : "已运行 ";

  if (name === "glob" || name.endsWith(".glob")) return `${verb}Glob`;
  if (name === "grep" || name.endsWith(".grep")) return `${verb}Grep`;
  if (name === "ls" || name.endsWith(".ls")) return `${verb}LS`;

  if (
    name === "read" ||
    name === "read_files" ||
    name.endsWith(".read") ||
    name.endsWith(".read_file")
  ) {
    if (status === "error" || status === "failed") return "失败：Read";
    return workflowStatusIsRunning(status) ? "正在运行 Read" : "已运行 Read";
  }

  return null;
}

function readableToolLabel(item: ToolCallRowItem): string {
  const name = toolName(item);
  const input = itemInputText(item);
  const firstLine =
    input
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "";

  if (name === "read" || name === "read_files" || name.endsWith(".read"))
    return `已读取 ${toolTargetCount(input) || 1} 个文件`;
  if (name === "workflow_read_file" || name.endsWith(".read_file"))
    return `已读取 ${basename(firstLine || input || "文件")}`;
  if (
    name === "glob" ||
    name.endsWith(".glob") ||
    name === "ls" ||
    name.endsWith(".ls")
  )
    return "已列出文件";
  if (name === "grep" || name.endsWith(".grep")) return "已搜索工作区";
  if (name.includes("tool_search")) return "已搜索工具";
  if (item.type === "webSearch")
    return input.includes('"type": "open_page"') ? "已打开页面" : "已搜索网页";
  if (item.type === "imageGeneration")
    return itemStatus(item) === "running" ? "正在生成图片" : "已生成图片";
  if (name === "token_count") return "已更新用量";
  if (name === "turn_aborted") return "已中断";
  if (name === "thread_rolled_back") return "已回滚";
  if (name === "update_plan" || name === "plan_snapshot") return "已更新计划";
  if (name === "js") return "已使用浏览器";
  if (isSearchToolName(name) || firstLine.startsWith("rg "))
    return firstLine.startsWith("rg --files")
      ? "已列出项目文件"
      : "已搜索工作区";

  if (
    name.includes("shell") ||
    name.includes("command") ||
    name === "commands"
  ) {
    if (/^Get-Content\b/i.test(firstLine))
      return `已读取 ${compactCommandTarget(firstLine, "Get-Content")}`;
    if (/^Get-ChildItem\b/i.test(firstLine)) return "已列出目录";
    if (/^Select-String\b/i.test(firstLine)) return "已搜索工作区";
    if (/^Get-NetTCPConnection\b/i.test(firstLine)) return "已检查开发服务";
    if (/^\$snapshot\s*=/i.test(firstLine)) return "已读取会话日志";
    if (/^\$listener\s*=/i.test(firstLine)) return "已重启开发服务";
    if (/^git status\b/i.test(firstLine)) return "已检查 Git 状态";
    if (/^npm run\b/i.test(firstLine)) return `已运行 ${firstLine}`;
    if (/^Start-Process\b/i.test(firstLine)) return "已启动开发服务";
    if (/^Stop-Process\b/i.test(firstLine)) return "已重启开发服务";
    if (/^Invoke-RestMethod\b/i.test(firstLine)) return "已调用本地 API";
    return firstLine ? `已运行 ${compactCommand(firstLine)}` : "已运行命令";
  }

  if (isEditToolName(name)) return "已编辑文件";
  if (name.includes("todo")) return "已更新待办";
  return `已运行 ${name || item.type}`;
}

function ToolSearchDetail({ data }: { data: ToolSearchDetailData }) {
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

function WebSearchDetail({ data }: { data: WebSearchDetailData }) {
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

function ImageGenerationDetail({ data }: { data: ImageGenerationDetailData }) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-primary">
        {data.hasResult ? "Image generated" : "Generating image"}
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

function PlanDetail({ steps }: { steps: PlanStep[] }) {
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
              <Check className="h-2.5 w-2.5" />
            ) : step.status === "in_progress" ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            ) : (
              <span />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="break-words text-text-normal">{step.step}</div>
            <div className="workflow-tool-muted">
              {planStatusLabel(step.status)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MarkdownDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-label">{label}</div>
      <div className="workflow-tool-markdown">
        <WorkflowMarkdownContent content={value} />
      </div>
    </div>
  );
}

function UsageDetail({ data }: { data: UsageDetailData }) {
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

function DetailBlock({
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
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    if (!value) return;
    try {
      await copyToClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="workflow-tool-section">
      <div className="workflow-tool-section-head">
        <span className="workflow-tool-label">{label}</span>
        <button
          type="button"
          className="workflow-tool-copy"
          onClick={(event) => {
            event.stopPropagation();
            void copyValue();
          }}
          title={copied ? "已复制" : "复制内容"}
          aria-label={copied ? "已复制内容" : `复制${label}`}
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <pre
        className={`workflow-tool-pre ${danger ? "danger" : ""} ${scrollable ? "scrollable" : ""}`}
      >
        {value}
      </pre>
    </div>
  );
}

function parsePlanSteps(input: string): PlanStep[] {
  if (!input.trim()) return [];

  try {
    const parsed = JSON.parse(input) as { plan?: unknown };
    if (!Array.isArray(parsed.plan)) return [];
    return parsed.plan
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const record = entry as Record<string, unknown>;
        const step = typeof record.step === "string" ? record.step.trim() : "";
        const status =
          typeof record.status === "string" ? record.status : "pending";
        return step ? { step, status } : null;
      })
      .filter((step): step is PlanStep => Boolean(step));
  } catch {
    return [];
  }
}

function parseToolSearchDetail(
  input: string,
  output: string,
): ToolSearchDetailData | null {
  let query: string;
  let limit: number | undefined;

  try {
    const parsed = JSON.parse(input) as { query?: unknown; limit?: unknown };
    query = typeof parsed.query === "string" ? parsed.query : input.trim();
    limit = typeof parsed.limit === "number" ? parsed.limit : undefined;
  } catch {
    query = input.trim();
  }

  const lines = output
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tools = lines
    .filter((line) => !/^Found\s+\d+\s+tools?:/i.test(line))
    .filter((line) => /^[\w@./:-]+$/.test(line));

  if (!query && !tools.length) return null;
  return { query, limit, tools };
}

function parseWebSearchDetail(
  input: string,
  output: string,
): WebSearchDetailData | null {
  const merged: WebSearchDetailData = {
    type: "",
    query: "",
    url: "",
    queries: [],
  };

  for (const value of [input, output]) {
    if (!value.trim()) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (!merged.type && typeof parsed.type === "string")
        merged.type = parsed.type;
      if (!merged.query && typeof parsed.query === "string")
        merged.query = parsed.query;
      if (!merged.url && typeof parsed.url === "string")
        merged.url = parsed.url;
      if (Array.isArray(parsed.queries)) {
        merged.queries = parsed.queries.filter(
          (query): query is string => typeof query === "string",
        );
      }
    } catch {
      if (!merged.query) merged.query = value.trim();
    }
  }

  if (!merged.type && !merged.query && !merged.url && !merged.queries.length)
    return null;
  return merged;
}

function parseImageGenerationDetail(
  input: string,
  output: string,
): ImageGenerationDetailData | null {
  const data: ImageGenerationDetailData = {
    prompt: "",
    status: "",
    hasResult: false,
  };

  for (const value of [input, output]) {
    if (!value.trim()) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (!data.prompt && typeof parsed.prompt === "string")
        data.prompt = parsed.prompt;
      if (!data.status && typeof parsed.status === "string")
        data.status = parsed.status;
      if (typeof parsed.has_result === "boolean")
        data.hasResult = parsed.has_result;
      if (typeof parsed.result_bytes === "number")
        data.resultBytes = parsed.result_bytes;
    } catch {
      if (!data.prompt) data.prompt = value.trim();
    }
  }

  if (!data.prompt && !data.status && !data.hasResult) return null;
  return data;
}

function parseUsageDetail(output: string): UsageDetailData | null {
  if (!output.trim()) return null;

  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return {
      totalTokens: numberFromRecord(parsed, "total_tokens"),
      lastTokens: numberFromRecord(parsed, "last_total_tokens"),
      contextWindow: numberFromRecord(parsed, "context_window"),
      primaryPercent: numberFromRecord(parsed, "rate_limit_primary_percent"),
      secondaryPercent: numberFromRecord(
        parsed,
        "rate_limit_secondary_percent",
      ),
      planType:
        typeof parsed.plan_type === "string" ? parsed.plan_type : undefined,
    };
  } catch {
    return null;
  }
}

function detailTitle(item: ToolCallRowItem): string {
  const name = toolName(item);
  if (name === "update_plan" || name === "plan_snapshot") return "Plan";
  if (name.includes("tool_search")) return "Tool search";
  if (item.type === "webSearch") return "Web search";
  if (item.type === "imageGeneration") return "Image generation";
  if (name === "token_count") return "Usage";
  if (name === "turn_aborted") return "Interrupted";
  if (name === "thread_rolled_back") return "Rolled back";
  const firstLine = itemInputText(item)
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim();
  if (firstLine && (name.includes("shell") || name.includes("command")))
    return compactCommand(firstLine);
  return name || item.type;
}

function detailInputLabel(item: ToolCallRowItem): string {
  const name = toolName(item);
  if (name.includes("shell") || name.includes("command")) return "Command";
  if (name === "update_plan" || name === "plan_snapshot") return "Plan";
  if (name.includes("tool_search")) return "Query";
  if (item.type === "webSearch") return "Search";
  if (item.type === "imageGeneration") return "Prompt";
  if (name === "token_count") return "Usage";
  if (name === "js") return "Script";
  return "Input";
}

function isReadToolName(name: string): boolean {
  return (
    name === "read" ||
    name.endsWith(".read") ||
    name === "read_file" ||
    name === "read_files" ||
    name.endsWith(".read_file") ||
    name.endsWith(".read_files")
  );
}

function isListToolName(name: string): boolean {
  return (
    name === "list" ||
    name === "ls" ||
    name.endsWith(".ls") ||
    name === "glob" ||
    name.endsWith(".glob") ||
    name === "list_files" ||
    name === "get_directory_tree" ||
    name.endsWith(".list_files")
  );
}

function isSearchToolName(name: string): boolean {
  return name.includes("search") || name === "grep" || name.endsWith(".grep");
}

function isEditToolName(name: string): boolean {
  return (
    name.includes("apply_patch") ||
    name.includes("patch") ||
    name.includes("edit") ||
    name.includes("write")
  );
}

function planStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In progress";
  return "Pending";
}

function planStatusTone(status: string): string {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "running";
  return "pending";
}

function exitCodeFromOutput(output: string): number | null {
  const match = output.match(/Exit code:\s*(-?\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

function cleanDetailOutput(output: string): string {
  if (!output) return "";
  const normalized = output.replace(/\r/g, "").trim();
  const outputIndex = normalized.indexOf("\nOutput:\n");
  if (outputIndex >= 0)
    return normalized.slice(outputIndex + "\nOutput:\n".length).trim();
  return normalized
    .replace(/^Exit code:\s*-?\d+\n/i, "")
    .replace(/^Wall time:\s*.+\n/i, "")
    .replace(/^Output:\n/i, "")
    .trim();
}

function compactCommandTarget(command: string, verb: string): string {
  const target = command
    .replace(new RegExp(`^${verb}\\s+(-Path\\s+)?`, "i"), "")
    .replace(/\s+-TotalCount\s+\d+.*/i, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  return basename(target || "file");
}

function compactCommand(command: string): string {
  return command;
}

function toolTargetCount(value: string): number {
  if (!value.trim()) return 0;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["files", "paths", "filePaths"]) {
        const entry = record[key];
        if (Array.isArray(entry)) return entry.length;
      }
    }
  } catch {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 1) return lines.length;
  }
  return 0;
}

function numberFromRecord(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function toolName(item: ToolCallRowItem): string {
  if (item.type === "mcpToolCall")
    return [item.server, item.tool].filter(Boolean).join(".") || item.tool;
  if (item.type === "dynamicToolCall") return item.tool.toLowerCase();
  if (item.type === "webSearch") return "web_search";
  if (item.type === "imageGeneration") return "image_generation";
  if (item.type === "plan") return "plan_snapshot";
  return "unknown";
}

export function itemStatus(item: ToolCallRowItem): string {
  if ("status" in item && typeof item.status === "string") return item.status;
  return "completed";
}

function formatCompactNumber(value?: number): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "-";
  return `${Math.round(value)}%`;
}

function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
