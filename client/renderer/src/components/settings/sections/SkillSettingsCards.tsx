import { FileText, Package, Trash2 } from "lucide-react";
import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceItem,
} from "@shared/types";
import {
  formatCount,
  formatRelativeTime,
  integrityLabel,
  scopeLabel,
} from "./skill-audit-formatters";

export function InstalledSkillCard({
  skill,
  canToggleSkills,
  removingSkillId,
  onSkillDetailChange,
  onSkillsChange,
  onRemove,
}: {
  skill: SkillInfo;
  canToggleSkills: boolean;
  removingSkillId: string | null;
  onSkillDetailChange: (detail: SkillDetail | null) => void;
  onSkillsChange: (skills: SkillInfo[]) => void;
  onRemove: (skill: SkillInfo) => void;
}) {
  return (
    <div
      className={`settings-row-card skill-list-row ${skill.enabled ? "" : "disabled"}`}
      key={skill.id}
      role="button"
      tabIndex={0}
      onClick={async () =>
        onSkillDetailChange(await window.marloues.skill.getDetail(skill.id))
      }
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void window.marloues.skill
          .getDetail(skill.id)
          .then(onSkillDetailChange);
      }}
    >
      <div className="skill-row-icon" aria-hidden="true">
        <Package size={18} />
      </div>
      <div className="skill-row-copy">
        <div className="skill-row-title">
          <strong>{skill.name}</strong>
          <small>
            {scopeLabel(skill.scope)}
            {skill.version ? ` · v${skill.version}` : ""}
            {skill.integrityStatus
              ? ` · ${integrityLabel(skill.integrityStatus)}`
              : ""}
          </small>
        </div>
        <p>{skill.description || skill.path}</p>
      </div>
      <div
        className="skill-row-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <button
          title="查看详情"
          onClick={async () => {
            onSkillDetailChange(
              await window.marloues.skill.getDetail(skill.id),
            );
          }}
        >
          <FileText size={14} />
        </button>
        {skill.removable ? (
          <button
            title="删除"
            disabled={removingSkillId === skill.id}
            onClick={() => {
              void onRemove(skill);
            }}
          >
            <Trash2 size={14} />
          </button>
        ) : null}
        <button
          className={`skill-switch ${skill.enabled ? "is-enabled" : "is-disabled"}`}
          disabled={!canToggleSkills}
          type="button"
          role="switch"
          aria-checked={skill.enabled}
          aria-label={`${skill.enabled ? "禁用" : "启用"} ${skill.name}`}
          title={
            canToggleSkills
              ? skill.enabled
                ? "禁用"
                : "启用"
              : "企业策略禁止修改技能启用状态"
          }
          onClick={async () => {
            onSkillsChange(
              await window.marloues.skill.toggle(skill.id, !skill.enabled),
            );
          }}
        >
          <span />
        </button>
      </div>
    </div>
  );
}

export function MarketplaceSkillCard({
  skill,
  marketplaceView,
  installingSlug,
  onOpenDetail,
  onInstall,
}: {
  skill: SkillMarketplaceItem;
  marketplaceView: "grid" | "list";
  installingSlug: string | null;
  onOpenDetail: (slug: string) => void;
  onInstall: (slug: string) => void;
}) {
  return (
    <div
      className={`skill-market-card ${marketplaceView === "list" ? "list" : ""} ${skill.installed ? "installed" : ""}`}
      key={skill.slug}
      role="button"
      tabIndex={0}
      onClick={() => void onOpenDetail(skill.slug)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void onOpenDetail(skill.slug);
      }}
    >
      <span className="skill-market-card-head">
        <span className="skill-row-icon" aria-hidden="true">
          <Package size={18} />
        </span>
        <span>
          <strong>{skill.name || skill.slug}</strong>
          <small>
            {skill.ownerHandle ? `@${skill.ownerHandle} - ` : ""}
            {skill.updatedAt
              ? `Updated ${formatRelativeTime(skill.updatedAt)} - `
              : ""}
            {skill.version ? `v${skill.version}` : skill.slug}
          </small>
        </span>
      </span>
      <span className="skill-market-description">
        {skill.description ||
          skill.sourceUrl ||
          "暂无简介，打开详情查看 Skill 内容与安装信息"}
      </span>
      <span className="skill-market-meta">
        <span>{formatCount(skill.stars)} stars</span>
        <span>{formatCount(skill.downloads)} downloads</span>
      </span>
      <button
        className="skill-market-install"
        type="button"
        disabled={skill.installed || installingSlug === skill.slug}
        onClick={(event) => {
          event.stopPropagation();
          if (!skill.installed) void onInstall(skill.slug);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {installingSlug === skill.slug
          ? "安装中"
          : skill.installed
            ? "\u5df2\u5b89\u88c5"
            : "\u5b89\u88c5"}
      </button>
    </div>
  );
}
