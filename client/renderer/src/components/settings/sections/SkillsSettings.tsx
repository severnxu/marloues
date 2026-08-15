import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  LayoutGrid,
  List as ListIcon,
  Package,
  RefreshCcw,
  Search,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import { STRINGS } from "@shared/strings.zh";
import type {
  SkillDetail,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
} from "@shared/types";
import { formatMarketplaceResultsLabel } from "./skill-audit-helpers";
import {
  MARKETPLACE_PAGE_SIZE,
  formatMarketplaceSummaryBody,
  mergeMarketplaceItems,
  normalizeMarketplaceResponse,
} from "./skill-audit-helpers";
import {
  InstalledSkillDetailModal,
  MarketplaceDetailModal,
} from "./SkillDetailModals";
import { InstalledSkillCard, MarketplaceSkillCard } from "./SkillSettingsCards";

export function SkillsSettings({
  canToggleSkills,
  enabledSkillCount,
  marketplaceCursor,
  marketplaceDetail,
  marketplaceError,
  marketplaceHasMore,
  marketplaceLoading,
  marketplaceQuery,
  marketplaceSkills,
  marketplaceTotal,
  marketplaceView,
  onMarketplaceCursorChange,
  onMarketplaceDetailChange,
  onMarketplaceErrorChange,
  onMarketplaceHasMoreChange,
  onMarketplaceLoadingChange,
  onMarketplaceQueryChange,
  onMarketplaceSkillsChange,
  onMarketplaceTotalChange,
  onMarketplaceViewChange,
  onSkillDetailChange,
  onSkillsChange,
  runtimeSkills,
  skillDetail,
  skills,
  skillTab,
  onSkillTabChange,
}: {
  canToggleSkills: boolean;
  enabledSkillCount: number;
  marketplaceCursor?: string;
  marketplaceDetail: SkillMarketplaceDetail | null;
  marketplaceError: string | null;
  marketplaceHasMore: boolean;
  marketplaceLoading: boolean;
  marketplaceQuery: string;
  marketplaceSkills: SkillMarketplaceItem[];
  marketplaceTotal?: number;
  marketplaceView: "grid" | "list";
  onMarketplaceCursorChange: Dispatch<SetStateAction<string | undefined>>;
  onMarketplaceDetailChange: Dispatch<
    SetStateAction<SkillMarketplaceDetail | null>
  >;
  onMarketplaceErrorChange: Dispatch<SetStateAction<string | null>>;
  onMarketplaceHasMoreChange: Dispatch<SetStateAction<boolean>>;
  onMarketplaceLoadingChange: Dispatch<SetStateAction<boolean>>;
  onMarketplaceQueryChange: Dispatch<SetStateAction<string>>;
  onMarketplaceSkillsChange: Dispatch<SetStateAction<SkillMarketplaceItem[]>>;
  onMarketplaceTotalChange: Dispatch<SetStateAction<number | undefined>>;
  onMarketplaceViewChange: Dispatch<SetStateAction<"grid" | "list">>;
  onSkillDetailChange: (detail: SkillDetail | null) => void;
  onSkillsChange: (skills: SkillInfo[]) => void;
  runtimeSkills: string[];
  skillDetail: SkillDetail | null;
  skills: SkillInfo[];
  skillTab: "installed" | "market" | "import";
  onSkillTabChange: (tab: "installed" | "market" | "import") => void;
}) {
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null);
  const marketplaceLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const visibleSkills = skills;
  const marketplaceSummaryBody = formatMarketplaceSummaryBody({
    count: marketplaceSkills.length,
    total: marketplaceTotal,
    loading: marketplaceLoading,
    query: marketplaceQuery,
  });
  const summaryTitle =
    skillTab === "installed"
      ? "已安装的 Skills"
      : skillTab === "market"
        ? "Skill 市场"
        : "导入 Skills";
  const summaryBody =
    skillTab === "installed"
      ? `已发现 ${skills.length} 个 Skill，${enabledSkillCount} 个已启用`
      : skillTab === "market"
        ? marketplaceSummaryBody
        : "从本地文件夹导入一个包含 SKILL.md 的 Skill";

  useEffect(() => {
    if (skillTab !== "market") return;
    if (marketplaceSkills.length > 0) return;
    void refreshMarketplace();
  }, [skillTab, marketplaceSkills.length]); // eslint-disable-line react-hooks/exhaustive-deps -- refreshMarketplace 每次渲染重建，加入会导致列表刷新循环

  useEffect(() => {
    if (skillTab !== "market" || !marketplaceHasMore || marketplaceLoading)
      return;
    const target = marketplaceLoadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreMarketplace();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMoreMarketplace 每次渲染重建，加入会导致 IntersectionObserver 每次渲染重建并可能重复加载
  }, [
    skillTab,
    marketplaceHasMore,
    marketplaceLoading,
    marketplaceCursor,
    marketplaceSkills.length,
    marketplaceQuery,
  ]);

  async function refreshMarketplace(query = marketplaceQuery): Promise<void> {
    await loadMarketplace({ query, reset: true });
  }

  async function loadMoreMarketplace(): Promise<void> {
    if (marketplaceLoading || !marketplaceHasMore) return;
    await loadMarketplace({ query: marketplaceQuery, reset: false });
  }

  async function loadMarketplace({
    query,
    reset,
  }: {
    query: string;
    reset: boolean;
  }): Promise<void> {
    onMarketplaceLoadingChange(true);
    onMarketplaceErrorChange(null);
    if (reset) {
      onMarketplaceSkillsChange([]);
      onMarketplaceCursorChange(undefined);
      onMarketplaceHasMoreChange(false);
      onMarketplaceTotalChange(undefined);
    }
    try {
      const trimmedQuery = query.trim();
      const shouldGrowLimit = !reset && (trimmedQuery || !marketplaceCursor);
      const limit = shouldGrowLimit
        ? Math.min(marketplaceSkills.length + MARKETPLACE_PAGE_SIZE, 200)
        : MARKETPLACE_PAGE_SIZE;
      const response = await window.marloues.skill.marketplaceList({
        query: trimmedQuery,
        limit,
        cursor: trimmedQuery
          ? undefined
          : reset
            ? undefined
            : marketplaceCursor,
      });
      const result = normalizeMarketplaceResponse(response);
      onMarketplaceSkillsChange((items) =>
        reset || trimmedQuery || shouldGrowLimit
          ? result.items
          : mergeMarketplaceItems(items, result.items),
      );
      onMarketplaceCursorChange(result.nextCursor);
      onMarketplaceHasMoreChange(
        result.hasMore &&
          (Boolean(result.nextCursor) ||
            result.items.length > marketplaceSkills.length),
      );
      onMarketplaceTotalChange(
        (total) => result.total ?? total ?? result.items.length,
      );
    } catch (error) {
      onMarketplaceErrorChange(
        error instanceof Error
          ? error.message
          : STRINGS.skill.marketplaceLoadFailed,
      );
    } finally {
      onMarketplaceLoadingChange(false);
    }
  }

  async function openMarketplaceDetail(slug: string): Promise<void> {
    onMarketplaceDetailChange(
      await window.marloues.skill.marketplaceDetail(slug),
    );
    onSkillDetailChange(null);
  }

  async function installMarketplaceSkill(slug: string): Promise<void> {
    if (installingSlug) return;
    setInstallingSlug(slug);
    try {
      const nextSkills = await window.marloues.skill.marketplaceInstall(slug);
      onSkillsChange(nextSkills);
      onMarketplaceSkillsChange((items) =>
        items.map((item) =>
          item.slug === slug ? { ...item, installed: true } : item,
        ),
      );
      onMarketplaceDetailChange((detail) =>
        detail?.slug === slug ? { ...detail, installed: true } : detail,
      );
      notify({
        title: STRINGS.skill.installSuccessTitle,
        description: slug,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: STRINGS.skill.installFailedTitle,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setInstallingSlug(null);
    }
  }

  async function removeInstalledSkill(skill: SkillInfo): Promise<void> {
    if (!skill.removable || removingSkillId) return;
    setRemovingSkillId(skill.id);
    try {
      const nextSkills = await window.marloues.skill.remove(skill.id);
      onSkillsChange(nextSkills);
      onSkillDetailChange(null);
      if (skill.scope === "marketplace") {
        onMarketplaceSkillsChange((items) =>
          items.map((item) =>
            item.slug === skill.name ? { ...item, installed: false } : item,
          ),
        );
        onMarketplaceDetailChange((detail) =>
          detail?.slug === skill.name
            ? { ...detail, installed: false }
            : detail,
        );
      }
      notify({
        title: STRINGS.skill.removeSuccessTitle,
        description: skill.name,
        tone: "success",
      });
    } catch (error) {
      notify({
        title: STRINGS.skill.removeFailedTitle,
        description: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    } finally {
      setRemovingSkillId(null);
    }
  }

  return (
    <div className={`skill-page-panel ${skillTab}`}>
      <div className="skill-page-tabs" aria-label="技能分类">
        <button
          className={skillTab === "installed" ? "active" : ""}
          type="button"
          onClick={() => onSkillTabChange("installed")}
        >
          已安装
        </button>
        <button
          className={skillTab === "market" ? "active" : ""}
          type="button"
          onClick={() => onSkillTabChange("market")}
        >
          市场
        </button>
        <button
          className={skillTab === "import" ? "active" : ""}
          type="button"
          onClick={() => onSkillTabChange("import")}
        >
          导入
        </button>
      </div>

      <div className="skill-page-summary">
        <div>
          <h2>{summaryTitle}</h2>
          <p>{summaryBody}</p>
        </div>
        <button
          type="button"
          title="刷新"
          onClick={async () => {
            if (skillTab === "market") {
              await refreshMarketplace();
              return;
            }
            onSkillsChange(await window.marloues.skill.list());
          }}
        >
          <RefreshCcw size={14} />
        </button>
      </div>

      {skillTab === "installed" && runtimeSkills.length ? (
        <div className="settings-runtime-panel">
          <div>
            <strong>SDK init Skills</strong>
            <small>这些 Skill 已被最近一次 SDK session 识别</small>
          </div>
          <div className="settings-chip-row">
            {runtimeSkills.map((skill) => (
              <span className="settings-chip ok" key={skill}>
                {skill}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {skillTab === "installed" ? (
        <div className="skill-grid">
          {visibleSkills.length === 0 ? (
            <div className="skill-empty-state">暂无已安装的 Skills</div>
          ) : null}
          {skills.map((skill) => (
            <InstalledSkillCard
              key={skill.id}
              skill={skill}
              canToggleSkills={canToggleSkills}
              removingSkillId={removingSkillId}
              onSkillDetailChange={onSkillDetailChange}
              onSkillsChange={onSkillsChange}
              onRemove={removeInstalledSkill}
            />
          ))}
        </div>
      ) : null}

      {skillTab === "market" ? (
        <div className="skill-market-pane">
          <form
            className="skill-market-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              void refreshMarketplace(marketplaceQuery);
            }}
          >
            <label>
              <Search size={14} />
              <input
                placeholder={"\u641c\u7d22 ClawHub Skill"}
                value={marketplaceQuery}
                onChange={(event) =>
                  onMarketplaceQueryChange(event.target.value)
                }
              />
            </label>
            <button type="submit">{"\u641c\u7d22"}</button>
          </form>
          <div className="skill-market-results-bar">
            <span>
              {formatMarketplaceResultsLabel(
                marketplaceSkills.length,
                marketplaceTotal,
              )}
            </span>
            <span
              className="skill-market-view-toggle"
              role="group"
              aria-label="市场显示方式"
            >
              <button
                className={marketplaceView === "list" ? "active" : ""}
                type="button"
                title="列表"
                onClick={() => onMarketplaceViewChange("list")}
              >
                <ListIcon size={14} />
                List
              </button>
              <button
                className={marketplaceView === "grid" ? "active" : ""}
                type="button"
                title="卡片"
                onClick={() => onMarketplaceViewChange("grid")}
              >
                <LayoutGrid size={14} />
                Grid
              </button>
            </span>
          </div>
          <div
            className={`skill-market-results scrollbar-thin ${marketplaceView}`}
          >
            {marketplaceLoading && marketplaceSkills.length === 0 ? (
              <div
                className="skill-market-loading"
                role="status"
                aria-label="正在加载 ClawHub 市场"
              >
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            ) : null}
            {marketplaceError ? (
              <div className="skill-empty-state">{marketplaceError}</div>
            ) : null}
            {!marketplaceLoading &&
            !marketplaceError &&
            marketplaceSkills.length === 0 ? (
              <div className="skill-empty-state">
                {
                  "\u5e02\u573a\u91cc\u8fd8\u6ca1\u6709\u53ef\u5c55\u793a\u7684 Skills"
                }
              </div>
            ) : null}
            {marketplaceSkills.map((skill) => (
              <MarketplaceSkillCard
                key={skill.slug}
                skill={skill}
                marketplaceView={marketplaceView}
                installingSlug={installingSlug}
                onOpenDetail={openMarketplaceDetail}
                onInstall={installMarketplaceSkill}
              />
            ))}
            {marketplaceSkills.length > 0 &&
            (marketplaceLoading || marketplaceHasMore) ? (
              <div
                className="skill-market-load-more"
                ref={marketplaceLoadMoreRef}
              >
                {marketplaceLoading ? (
                  <span
                    className="skill-market-loading compact"
                    role="status"
                    aria-label="正在加载更多 ClawHub 技能"
                  >
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                    <span aria-hidden="true" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void loadMoreMarketplace()}
                  >
                    加载更多
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {skillTab === "import" ? (
        <div className="skill-import-state">
          <Package size={18} />
          <strong>导入本地 Skill 文件夹</strong>
          <p>选择包含 SKILL.md 的文件夹，导入后会出现在已安装列表中。</p>
          <button
            type="button"
            onClick={async () => {
              await window.marloues.skill.importFolder();
              onSkillsChange(await window.marloues.skill.list());
              onSkillTabChange("installed");
            }}
          >
            <Package size={14} />
            选择文件夹
          </button>
        </div>
      ) : null}

      {skillTab !== "import" && skillDetail ? (
        <InstalledSkillDetailModal
          skillDetail={skillDetail}
          removingSkillId={removingSkillId}
          onSkillDetailChange={onSkillDetailChange}
          onRemove={removeInstalledSkill}
        />
      ) : null}

      {skillTab === "market" && marketplaceDetail ? (
        <MarketplaceDetailModal
          marketplaceDetail={marketplaceDetail}
          installingSlug={installingSlug}
          onMarketplaceDetailChange={onMarketplaceDetailChange}
          onInstall={installMarketplaceSkill}
        />
      ) : null}
    </div>
  );
}
