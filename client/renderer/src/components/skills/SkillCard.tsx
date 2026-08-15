import { Package, Search, Trash2 } from "lucide-react";
import type { SkillInfo, SkillMarketplaceItem } from "@shared/types";
import { scopeLabel } from "./skill-formatters";

export function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button role="tab" aria-selected={active} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function activateCard(event: React.KeyboardEvent, activate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

export function SkillMarketplaceCard({
  skill,
  layout,
  selected,
  installingSlug,
  onSelect,
  onInstall,
}: {
  skill: SkillMarketplaceItem;
  layout: "grid" | "list";
  selected: boolean;
  installingSlug: string | null;
  onSelect: (slug: string) => void;
  onInstall: (slug: string) => void;
}) {
  const name = skill.cnName || skill.name || skill.slug;
  return (
    <article
      className={`plugin-card${layout === "list" ? " is-list" : ""}${selected ? " is-selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${name} ${skill.installed ? "已安装" : "未安装"}`}
      onClick={() => onSelect(skill.slug)}
      onKeyDown={(event) => activateCard(event, () => onSelect(skill.slug))}
    >
      <header className="plugin-card-head">
        <span className="plugin-card-identity">
          <strong>{name}</strong>
          <small>
            {skill.ownerHandle || "Skill 市场"} · v{skill.version || "latest"}
          </small>
        </span>
        <span
          className={`plugin-install-status${skill.installed ? " is-installed" : ""}`}
        >
          {skill.installed ? "已安装" : "未安装"}
        </span>
      </header>
      <p>
        {skill.description || "暂无简介，打开详情查看 Skill 内容与安装信息。"}
      </p>
      <footer
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {skill.installed ? (
          <span />
        ) : (
          <button
            className="plugin-install-button"
            type="button"
            disabled={installingSlug === skill.slug}
            onClick={() => onInstall(skill.slug)}
          >
            {installingSlug === skill.slug ? "安装中..." : "安装"}
          </button>
        )}
      </footer>
    </article>
  );
}

export function SkillInstalledCard({
  skill,
  layout,
  selected,
  canToggle,
  removingSkillId,
  onSelect,
  onRemove,
  onToggle,
}: {
  skill: SkillInfo;
  layout: "grid" | "list";
  selected: boolean;
  canToggle: boolean;
  removingSkillId: string | null;
  onSelect: (id: string) => void;
  onRemove: (skill: SkillInfo) => void;
  onToggle: (skill: SkillInfo) => void;
}) {
  return (
    <article
      className={`plugin-card${layout === "list" ? " is-list" : ""}${selected ? " is-selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${skill.name} 已安装`}
      onClick={() => onSelect(skill.id)}
      onKeyDown={(event) => activateCard(event, () => onSelect(skill.id))}
    >
      <header className="plugin-card-head">
        <span className="plugin-card-identity">
          <strong>{skill.name}</strong>
          <small>
            {scopeLabel(skill.scope) || "本地"}
            {skill.version ? ` · v${skill.version}` : ""}
          </small>
        </span>
        <span className="plugin-install-status is-installed">已安装</span>
      </header>
      <p>{skill.description || skill.path}</p>
      <footer
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <span />
        <div className="plugin-card-actions">
          {skill.removable ? (
            <button
              className="plugin-card-icon-action is-danger"
              type="button"
              title="删除"
              aria-label={`删除 ${skill.name}`}
              disabled={removingSkillId === skill.id}
              onClick={() => onRemove(skill)}
            >
              <Trash2 aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="scheduled-switch"
            type="button"
            role="switch"
            aria-checked={skill.enabled}
            aria-label={`${skill.enabled ? "停用" : "启用"} ${skill.name}`}
            disabled={!canToggle}
            onClick={() => onToggle(skill)}
          >
            <span />
          </button>
        </div>
      </footer>
    </article>
  );
}

export function SkillListSkeleton({ isGrid }: { isGrid: boolean }) {
  return (
    <div
      className={`plugin-card-grid${isGrid ? "" : " is-list"}`}
      role="status"
      aria-label="正在加载"
    >
      {Array.from({ length: isGrid ? 6 : 3 }).map((_, index) => (
        <div
          className="plugin-card plugin-card-skeleton"
          key={index}
          aria-hidden="true"
        >
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function SkillListEmpty({ view }: { view: "discover" | "installed" }) {
  return (
    <div className="plugin-empty-state">
      <span>
        {view === "discover" ? (
          <Search aria-hidden="true" />
        ) : (
          <Package aria-hidden="true" />
        )}
      </span>
      <strong>
        {view === "discover"
          ? "没有找到符合条件的 Skill"
          : "暂无已安装的 Skill"}
      </strong>
      <p>
        {view === "discover"
          ? "尝试更换搜索词"
          : "从市场安装 Skill，或点击「本地导入」添加本地 Skill"}
      </p>
    </div>
  );
}
