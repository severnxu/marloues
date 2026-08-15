import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Download, Package, X } from "lucide-react";
import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
} from "@shared/types";
import {
  buildSkillFileTree,
  buildSkillVersions,
  computeSkillSecurity,
  normalizeSkill,
} from "./skill-normalizers";
import { formatDate, integrityLabel, scopeLabel } from "./skill-formatters";
import { SkillFileTree } from "./SkillFileTree";

type DetailTab = "skillmd" | "tree" | "security" | "history";

export function SkillDetailModal({
  kind,
  detail,
  skill,
  installingSlug,
  onClose,
  onUse,
  onInstall,
}: {
  kind: "market" | "installed";
  detail: SkillMarketplaceDetail | SkillDetail | null;
  skill: SkillMarketplaceItem | SkillInfo | null;
  installingSlug: string | null;
  onClose: () => void;
  onUse: () => void;
  onInstall: (slug: string, version?: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("skillmd");
  const [viewVersion, setViewVersion] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState("SKILL.md");

  const data = normalizeSkill(detail ?? skill, kind);
  const version = data.version ?? null;
  const viewing = viewVersion ?? version;
  const isHistory = !!version && !!viewing && viewing !== version;

  const versions = useMemo(() => buildSkillVersions(data), [data]);
  const security = useMemo(() => computeSkillSecurity(data), [data]);
  const fileTree = useMemo(() => buildSkillFileTree(data), [data]);

  const content = data.content ?? "";
  const subtitle =
    kind === "market"
      ? `${data.ownerHandle || data.slug}${version ? ` · v${version}` : ""}`
      : `${scopeLabel(data.scope as SkillInfo["scope"]) || "本地"}${version ? ` · v${version}` : ""}${data.integrityStatus ? ` · ${integrityLabel(data.integrityStatus)}` : ""}`;

  const tabs: Array<[DetailTab, string]> = [
    ["skillmd", "SKILL.md"],
    ["tree", "技能文件树"],
    ["security", "安全检测"],
    ["history", "历史版本"],
  ];

  return createPortal(
    <div
      className="skill-detail-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="skill-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${data.name} 详情`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="skill-detail-head">
          <div className="skill-row-icon" aria-hidden="true">
            <Package size={18} />
          </div>
          <div>
            <strong>{data.cnName || data.name}</strong>
            <small>{subtitle}</small>
          </div>
          <button className="icon-button" title="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="skill-detail-versionbar">
          <span className="vlabel">版本</span>
          <strong>
            v{viewing ?? version ?? "未知"}
            {!isHistory ? " · 当前" : ""}
          </strong>
        </div>

        {isHistory ? (
          <div className="sd-version-note">
            <AlertCircle size={14} />
            <span>
              正在查看历史版本 <b>v{viewing}</b>{" "}
              的快照，切换后其余标签页同步更新。
            </span>
          </div>
        ) : null}

        <div
          className="skill-detail-tabs"
          role="tablist"
          aria-label="Skill 详情"
          onKeyDown={(event) => {
            if (
              event.key !== "ArrowLeft" &&
              event.key !== "ArrowRight" &&
              event.key !== "Home" &&
              event.key !== "End"
            ) {
              return;
            }
            event.preventDefault();
            const currentIndex = tabs.findIndex(([key]) => key === tab);
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (currentIndex +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            setTab(tabs[nextIndex][0]);
            requestAnimationFrame(() => {
              event.currentTarget
                .querySelectorAll<HTMLElement>('[role="tab"]')
                [nextIndex]?.focus();
            });
          }}
        >
          {tabs.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => setTab(k)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="skill-detail-body">
          {tab === "skillmd" ? (
            content ? (
              <pre>{content}</pre>
            ) : (
              <p className="skill-detail-description">暂无 SKILL.md 内容。</p>
            )
          ) : null}

          {tab === "tree" ? (
            <div className="skill-file-browser">
              <nav aria-label="Skill 文件">
                <SkillFileTree
                  nodes={fileTree}
                  selectedPath={selectedFile}
                  onSelect={setSelectedFile}
                />
              </nav>
              <section className="skill-file-preview">
                <header>{selectedFile}</header>
                {selectedFile === "SKILL.md" && content ? (
                  <pre>{content}</pre>
                ) : (
                  <p>当前版本未提供此文件的只读内容预览。</p>
                )}
              </section>
            </div>
          ) : null}

          {tab === "security" ? (
            <div>
              <div
                className={`skill-detail-security ${security.verdict !== "clean" && security.verdict !== "unknown" ? `is-${security.verdict}` : ""}`}
              >
                <p className="skill-detail-section-label">安全扫描结论</p>
                <p className="skill-detail-description">{security.summary}</p>
              </div>
              {security.perms.length ? (
                <div>
                  <p className="skill-detail-section-label">声明的权限</p>
                  <div className="sd-perm-chips">
                    {security.perms.map((p) => (
                      <span
                        key={p}
                        className={`pill ${/write|delete|exec/i.test(p) ? "warn" : ""}`}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <dl className="sd-meta-grid">
                <div className="m">
                  <dt>完整性</dt>
                  <dd>
                    {kind === "installed" && data.integrityStatus
                      ? integrityLabel(data.integrityStatus)
                      : "未校验"}
                  </dd>
                </div>
                <div className="m">
                  <dt>来源</dt>
                  <dd>
                    {scopeLabel(data.scope as SkillInfo["scope"]) || "未知"}
                  </dd>
                </div>
                <div className="m">
                  <dt>可信</dt>
                  <dd>{data.trusted ? "是" : "未标记"}</dd>
                </div>
                <div className="m">
                  <dt>可移除</dt>
                  <dd>{data.removable ? "是" : "否"}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {tab === "history" ? (
            <div className="sd-versions">
              {versions.map((v, idx) => {
                const active = v.version === viewing;
                return (
                  <div
                    key={`${v.version}#${idx}`}
                    className={`sd-version-item ${v.current ? "is-current" : ""}`}
                  >
                    <div>
                      <div className="sd-version-top">
                        <b>v{v.version}</b>
                        {v.current ? (
                          <span className="sd-version-pill on">当前</span>
                        ) : null}
                        {active ? (
                          <span className="sd-version-pill">正在查看</span>
                        ) : null}
                      </div>
                      <small>
                        {formatDate(v.date)} · @{v.author}
                      </small>
                      <p>{v.note}</p>
                    </div>
                    <button
                      className="sd-btn sd-btn-ghost"
                      type="button"
                      disabled={active}
                      onClick={() => setViewVersion(v.version)}
                    >
                      {active ? "查看中" : "切换"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="skill-detail-actions">
          {kind === "market" && !data.installed ? (
            <button
              className="sd-btn sd-btn-primary"
              type="button"
              disabled={installingSlug === data.slug}
              onClick={() =>
                onInstall(data.slug ?? data.name, viewing ?? undefined)
              }
            >
              <Download size={14} />
              {installingSlug === data.slug ? "安装中" : "安装"}
            </button>
          ) : (
            <button
              className="sd-btn sd-btn-primary"
              type="button"
              onClick={onUse}
            >
              去使用
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
