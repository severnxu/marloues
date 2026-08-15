import { Download, FileText, RefreshCcw, TerminalSquare } from "lucide-react";
import { EmptySettingsState, SettingsCard } from "@/components/settings";
import type { AuditEventRecord } from "@shared/types";
import { STRINGS } from "@shared/strings.zh";

export function AuditSettings({
  auditEvents,
  onAuditEventsChange,
  onStatus,
}: {
  auditEvents: AuditEventRecord[];
  onAuditEventsChange: (events: AuditEventRecord[]) => void;
  onStatus: (message: string, tone: "info" | "ok" | "error") => void;
}) {
  return (
    <SettingsCard
      title="工具调用审计"
      description="查看、导出最近的工具调用记录，方便排查权限、路径、端点和上下文。"
      icon={<FileText size={16} />}
      surface="plain"
      action={
        <div className="settings-toolbar">
          <button
            onClick={async () =>
              onAuditEventsChange(await window.marloues.audit.list(100))
            }
          >
            <RefreshCcw size={14} />
            刷新
          </button>
          <button
            onClick={async () => {
              const events = await window.marloues.audit.list(500);
              const blob = new Blob([JSON.stringify(events, null, 2)], {
                type: "application/json;charset=utf-8",
              });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = `marloues-audit-${new Date().toISOString().slice(0, 10)}.json`;
              document.body.append(anchor);
              anchor.click();
              anchor.remove();
              URL.revokeObjectURL(url);
              onStatus(`已导出 ${events.length} 条审计记录`, "ok");
            }}
          >
            <Download size={14} />
            导出审计日志
          </button>
          <button
            onClick={async () => {
              const filePath = await window.marloues.app.exportDiagnostics();
              if (filePath) onStatus(`诊断包已导出：${filePath}`, "ok");
            }}
          >
            <FileText size={14} />
            导出诊断包
          </button>
        </div>
      }
    >
      <div className="audit-event-list">
        {auditEvents.length === 0 ? (
          <EmptySettingsState
            title="还没有审计记录"
            body="发送一次会触发工具的对话后，这里会显示工具名称、端点、输入摘要、输出摘要和执行状态。"
          />
        ) : null}
        {auditEvents.map((event) => (
          <div
            className={`audit-event-card ${event.isError ? "is-error" : ""}`}
            key={event.id}
          >
            <div className="audit-card-header">
              <span className="audit-card-tool">
                <TerminalSquare size={15} />
                <strong>{event.toolName}</strong>
              </span>
              <span
                className={`audit-status-badge ${event.isError ? "error" : event.status === "completed" ? "ok" : "pending"}`}
              >
                {event.isError
                  ? STRINGS.system.audit.failed
                  : event.status === "completed"
                    ? STRINGS.system.audit.success
                    : event.status}
              </span>
            </div>
            <div className="audit-card-meta">
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              {event.endpointProfileName ? (
                <span>{event.endpointProfileName}</span>
              ) : null}
              {event.workspacePath ? (
                <span className="audit-card-path">{event.workspacePath}</span>
              ) : null}
            </div>
            {event.inputSummary ? (
              <div className="audit-card-section">
                <span className="audit-card-label">输入</span>
                <pre className="audit-card-code">{event.inputSummary}</pre>
              </div>
            ) : null}
            {event.outputSummary ? (
              <div className="audit-card-section">
                <span className="audit-card-label">输出</span>
                <pre className="audit-card-code">{event.outputSummary}</pre>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}
