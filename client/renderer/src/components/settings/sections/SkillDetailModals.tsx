import { createPortal } from "react-dom";
import { Download, Package, Trash2, X } from "lucide-react";
import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
} from "@shared/types";
import {
  integrityLabel,
  scopeLabel,
  securityLabel,
} from "./skill-audit-formatters";

export function InstalledSkillDetailModal({
  skillDetail,
  removingSkillId,
  onSkillDetailChange,
  onRemove,
}: {
  skillDetail: SkillDetail;
  removingSkillId: string | null;
  onSkillDetailChange: (detail: SkillDetail | null) => void;
  onRemove: (skill: SkillInfo) => void;
}) {
  return createPortal(
    <div
      className="skill-detail-overlay"
      role="presentation"
      onMouseDown={() => onSkillDetailChange(null)}
    >
      <div
        className="skill-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${skillDetail.name} 详情`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="skill-detail-head">
          <div className="skill-row-icon" aria-hidden="true">
            <Package size={18} />
          </div>
          <div>
            <strong>{skillDetail.name}</strong>
            <small>
              {scopeLabel(skillDetail.scope)}
              {skillDetail.version ? ` · v${skillDetail.version}` : ""}
              {skillDetail.integrityStatus
                ? ` · ${integrityLabel(skillDetail.integrityStatus)}`
                : ""}
            </small>
          </div>
          <button title="关闭" onClick={() => onSkillDetailChange(null)}>
            <X size={15} />
          </button>
        </div>
        {skillDetail.description ? (
          <p className="skill-detail-description">{skillDetail.description}</p>
        ) : null}
        {skillDetail.permissions?.length ? (
          <div className="settings-chip-row">
            {skillDetail.permissions.map((permission) => (
              <span className="settings-chip" key={permission}>
                {permission}
              </span>
            ))}
          </div>
        ) : null}
        <pre>{skillDetail.content}</pre>
        {skillDetail.removable ? (
          <div className="skill-detail-actions">
            <button
              className="danger"
              type="button"
              disabled={removingSkillId === skillDetail.id}
              onClick={() => void onRemove(skillDetail)}
            >
              <Trash2 size={14} />
              {removingSkillId === skillDetail.id ? "删除中" : "删除 Skill"}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function MarketplaceDetailModal({
  marketplaceDetail,
  installingSlug,
  onMarketplaceDetailChange,
  onInstall,
}: {
  marketplaceDetail: SkillMarketplaceDetail;
  installingSlug: string | null;
  onMarketplaceDetailChange: (detail: SkillMarketplaceDetail | null) => void;
  onInstall: (slug: string) => void;
}) {
  return createPortal(
    <div
      className="skill-detail-overlay"
      role="presentation"
      onMouseDown={() => onMarketplaceDetailChange(null)}
    >
      <div
        className="skill-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${marketplaceDetail.name} 详情`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="skill-detail-head">
          <div className="skill-row-icon" aria-hidden="true">
            <Package size={18} />
          </div>
          <div>
            <strong>{marketplaceDetail.name}</strong>
            <small>
              {marketplaceDetail.ownerHandle
                ? `${marketplaceDetail.ownerHandle} - `
                : ""}
              {marketplaceDetail.version
                ? `v${marketplaceDetail.version}`
                : marketplaceDetail.slug}
              {marketplaceDetail.securityStatus
                ? ` - ${securityLabel(marketplaceDetail.securityStatus)}`
                : ""}
            </small>
          </div>
          <button
            title={"\u5173\u95ed"}
            onClick={() => onMarketplaceDetailChange(null)}
          >
            <X size={15} />
          </button>
        </div>
        {marketplaceDetail.description ? (
          <p className="skill-detail-description">
            {marketplaceDetail.description}
          </p>
        ) : null}
        {marketplaceDetail.securitySummary ? (
          <p className="skill-detail-description">
            {marketplaceDetail.securitySummary}
          </p>
        ) : null}
        <pre>{marketplaceDetail.content}</pre>
        {!marketplaceDetail.installed ? (
          <div className="skill-detail-actions">
            <button
              className="primary"
              type="button"
              disabled={
                installingSlug === marketplaceDetail.slug ||
                marketplaceDetail.securityStatus !== "clean"
              }
              title={
                marketplaceDetail.securityStatus === "clean"
                  ? "\u5b89\u88c5\u5230\u672c\u5730\u5e02\u573a"
                  : "\u5b89\u5168\u626b\u63cf\u672a\u901a\u8fc7\uff0c\u6682\u4e0d\u5141\u8bb8\u76f4\u63a5\u5b89\u88c5"
              }
              onClick={() => void onInstall(marketplaceDetail.slug)}
            >
              <Download size={14} />
              {installingSlug === marketplaceDetail.slug
                ? "安装中"
                : "\u5b89\u88c5"}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
