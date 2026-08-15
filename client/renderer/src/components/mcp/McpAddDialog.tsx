import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { PlugZap, Plus, X } from "lucide-react";
import {
  formatMcpAddModeHint,
  updateArrayValue,
  type McpAddDraft,
  type McpAddMode,
} from "@/components/settings";

const MCP_JSON_EXAMPLE = `{
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "Authorization": "Bearer <token>"
  }
}`;

export function McpAddDialog({
  mode,
  setMode,
  draft,
  setDraft,
  canEdit,
  saving,
  editing,
  error,
  onSubmit,
  onCancel,
  onReset,
}: {
  mode: McpAddMode;
  setMode: (mode: McpAddMode) => void;
  draft: McpAddDraft;
  setDraft: Dispatch<SetStateAction<McpAddDraft>>;
  canEdit: boolean;
  saving: boolean;
  editing: boolean;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving]);

  const chooseMode = (nextMode: McpAddMode) => {
    setMode(nextMode);
    if (nextMode === "json" && !draft.json) {
      setDraft((current) => ({ ...current, json: MCP_JSON_EXAMPLE }));
    }
  };

  const argumentsList = draft.args.length ? draft.args : [""];
  const methods: Array<[McpAddMode, string, string]> = [
    ["stdio", "命令", "本地进程"],
    ["http", "HTTP", "远程服务"],
    ["sse", "SSE", "远程事件流"],
    ["json", "JSON", "高级配置"],
  ];

  return createPortal(
    <div
      className="mcp-service-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <section
        className="mcp-service-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-service-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="mcp-service-header">
          <div className="mcp-service-heading">
            <span className="mcp-service-heading-icon">
              <PlugZap aria-hidden="true" />
            </span>
            <div>
              <strong id="mcp-service-title">
                {editing ? "编辑 MCP 服务" : "添加 MCP 服务"}
              </strong>
              <small>
                {editing
                  ? "修改连接信息并保存更改"
                  : "选择接入方式并填写连接信息"}
              </small>
            </div>
          </div>
          <button
            className="icon-button compact"
            type="button"
            aria-label="关闭 MCP 服务弹窗"
            onClick={onCancel}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div
          className="mcp-connection-tabs"
          role="tablist"
          aria-label="MCP 接入方式"
        >
          {methods.map(([method, label, note]) => (
            <button
              key={method}
              className={mode === method ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={mode === method}
              tabIndex={mode === method ? 0 : -1}
              onClick={() => chooseMode(method)}
            >
              <strong>{label}</strong>
              <small>{note}</small>
            </button>
          ))}
        </div>

        <div className="mcp-service-form">
          <label className="mcp-service-field">
            <span>服务名称</span>
            <input
              ref={nameRef}
              value={draft.name}
              disabled={!canEdit}
              placeholder="playwright"
              autoComplete="off"
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
            />
          </label>

          {mode === "stdio" ? (
            <section>
              <label className="mcp-service-field">
                <span>启动命令</span>
                <input
                  value={draft.command}
                  disabled={!canEdit}
                  placeholder="npx @playwright/mcp@latest"
                  autoComplete="off"
                  onChange={(event) =>
                    setDraft({ ...draft, command: event.target.value })
                  }
                />
              </label>
              <div className="mcp-service-field">
                <span>参数</span>
                <div className="mcp-argument-list">
                  {argumentsList.map((argument, index) => (
                    <div className="mcp-argument-row" key={index}>
                      <input
                        value={argument}
                        aria-label={`启动参数 ${index + 1}`}
                        disabled={!canEdit}
                        placeholder="-y"
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            args: updateArrayValue(
                              current.args.length ? current.args : [""],
                              index,
                              event.target.value,
                            ),
                          }))
                        }
                      />
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => {
                          if (index === 0) {
                            setDraft((current) => ({
                              ...current,
                              args: [
                                ...(current.args.length ? current.args : [""]),
                                "",
                              ],
                            }));
                          } else {
                            setDraft((current) => ({
                              ...current,
                              args: current.args.filter(
                                (_, candidate) => candidate !== index,
                              ),
                            }));
                          }
                        }}
                      >
                        {index === 0 ? (
                          <>
                            <Plus aria-hidden="true" />
                            <span>添加</span>
                          </>
                        ) : (
                          <X aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {mode === "http" || mode === "sse" ? (
            <section>
              <label className="mcp-service-field">
                <span>
                  服务 URL{" "}
                  <small>
                    {mode === "http" ? "STREAMABLE HTTP" : "SSE 端点"}
                  </small>
                </span>
                <input
                  type="url"
                  value={draft.url}
                  disabled={!canEdit}
                  placeholder={
                    mode === "http"
                      ? "https://example.com/mcp"
                      : "https://example.com/sse"
                  }
                  onChange={(event) =>
                    setDraft({ ...draft, url: event.target.value })
                  }
                />
              </label>
            </section>
          ) : null}

          {mode === "json" ? (
            <section>
              <label className="mcp-service-field">
                <span>配置 JSON</span>
                <textarea
                  value={draft.json}
                  disabled={!canEdit}
                  spellCheck={false}
                  onChange={(event) =>
                    setDraft({ ...draft, json: event.target.value })
                  }
                />
              </label>
            </section>
          ) : null}

          <label className="mcp-auto-enable">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!canEdit}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.target.checked })
              }
            />
            <span>默认启用</span>
          </label>
          {error ? (
            <p className="mcp-service-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="mcp-service-footer">
          <p>{formatMcpAddModeHint(mode)}</p>
          <div>
            <button
              type="button"
              disabled={!canEdit || saving}
              onClick={onReset}
            >
              {editing ? "重置" : "清空"}
            </button>
            <button
              className="mcp-service-submit"
              type="button"
              disabled={!canEdit || saving}
              onClick={onSubmit}
            >
              <Plus aria-hidden="true" />
              <span>
                {saving ? "保存中..." : editing ? "保存更改" : "添加服务"}
              </span>
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
