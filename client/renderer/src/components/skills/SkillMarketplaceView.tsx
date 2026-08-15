import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutGrid,
  List as ListIcon,
  RefreshCcw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { notify } from "@/lib/notifications";
import type {
  AgentSettings,
  SkillDetail,
  SkillImportPreview,
  SkillInfo,
  SkillMarketplaceDetail,
  SkillMarketplaceItem,
} from "@shared/types";
import type {
  SkillMarketplaceViewProps,
  SkillSelection,
  SkillView,
} from "./skill-constants";
import { MARKETPLACE_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from "./skill-constants";
import { formatMarketplaceResultsLabel } from "./skill-formatters";
import { mergeMarketplaceItems } from "./skill-normalizers";
import { SkillDetailModal } from "./SkillDetailModal";
import { SkillLocalImportDialog } from "./SkillLocalImportDialog";
import {
  SegmentButton,
  SkillInstalledCard,
  SkillListEmpty,
  SkillListSkeleton,
  SkillMarketplaceCard,
} from "./SkillCard";

export function SkillMarketplaceView({ onClose }: SkillMarketplaceViewProps) {
  const [view, setView] = useState<SkillView>("discover");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [marketplaceView, setMarketplaceView] = useState<"grid" | "list">(
    "grid",
  );
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(
    null,
  );
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<
    SkillMarketplaceItem[]
  >([]);
  const [marketplaceDetail, setMarketplaceDetail] =
    useState<SkillMarketplaceDetail | null>(null);
  const [installedDetail, setInstalledDetail] = useState<SkillDetail | null>(
    null,
  );
  const [selected, setSelected] = useState<SkillSelection>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [total, setTotal] = useState<number | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localImportOpen, setLocalImportOpen] = useState(false);
  const [localImportPreview, setLocalImportPreview] =
    useState<SkillImportPreview | null>(null);
  const [localImportBusy, setLocalImportBusy] = useState(false);
  const [localImportError, setLocalImportError] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(value);
    }, SEARCH_DEBOUNCE_MS);
  }, []);
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // Search submission handler – use debounced query
  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      setDebouncedQuery(query);
      setView("discover");
    },
    [query],
  );

  const canToggleSkills =
    (agentSettings?.enterprisePolicy?.allowLocalSkillDisable ?? true) !== false;
  const filteredInstalledSkills = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return skills;
    return skills.filter((skill) =>
      [skill.name, skill.description, skill.path]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalized)),
    );
  }, [query, skills]);
  const selectedMarketplaceSkill =
    selected?.kind === "market"
      ? (marketplaceSkills.find((s) => s.slug === selected.slug) ?? null)
      : null;
  const selectedInstalledSkill =
    selected?.kind === "installed"
      ? (skills.find((s) => s.id === selected.id) ?? null)
      : null;

  const loadInstalledSkills = useCallback(async () => {
    setSkills(await window.marloues.skill.list());
  }, []);
  const loadAgentSettings = useCallback(async () => {
    try {
      setAgentSettings(await window.marloues.config.getAgentSettings());
    } catch {
      /* optional */
    }
  }, []);
  const loadMarketplace = useCallback(
    async ({
      reset,
      nextQuery = debouncedQuery,
    }: {
      reset: boolean;
      nextQuery?: string;
    }) => {
      setLoading(true);
      setError(null);
      try {
        const trimmedQuery = nextQuery.trim();
        const nextPageNo =
          reset || trimmedQuery ? 1 : cursor ? Number(cursor) : 1;
        const response = await window.marloues.skill.marketplaceList({
          query: trimmedQuery,
          pageNo: nextPageNo,
          pageSize: MARKETPLACE_PAGE_SIZE,
        });
        setMarketplaceSkills((items) =>
          reset || trimmedQuery
            ? response.items
            : mergeMarketplaceItems(items, response.items),
        );
        setCursor(response.nextCursor);
        setTotal(response.total);
        setHasMore(response.hasMore);
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载 Skill 市场失败");
      } finally {
        setLoading(false);
      }
    },
    [cursor, debouncedQuery],
  );

  const refreshCurrentView = useCallback(async () => {
    if (view === "discover") {
      await loadMarketplace({ reset: true });
      return;
    }
    await loadInstalledSkills();
  }, [view, loadMarketplace, loadInstalledSkills]);

  const selectLocalSkill = useCallback(async () => {
    setLocalImportError(null);
    try {
      setLocalImportPreview(await window.marloues.skill.selectImportFolder());
    } catch (caught) {
      setLocalImportError(
        caught instanceof Error ? caught.message : "无法读取该 Skill 目录",
      );
    }
  }, []);

  const importLocalSkill = useCallback(async () => {
    if (!localImportPreview || localImportBusy) return;
    setLocalImportBusy(true);
    setLocalImportError(null);
    try {
      const imported = await window.marloues.skill.importFolder(
        localImportPreview.path,
      );
      if (!imported) return;
      await loadInstalledSkills();
      setView("installed");
      setSelected({ kind: "installed", id: imported.id });
      setLocalImportOpen(false);
      setLocalImportPreview(null);
      notify({
        title: "Skill 已导入",
        description: imported.name,
        tone: "success",
      });
    } catch (caught) {
      setLocalImportError(
        caught instanceof Error ? caught.message : "导入 Skill 失败",
      );
    } finally {
      setLocalImportBusy(false);
    }
  }, [loadInstalledSkills, localImportBusy, localImportPreview]);

  useEffect(() => {
    void loadInstalledSkills();
    void loadMarketplace({ reset: true });
    void loadAgentSettings();
  }, [loadInstalledSkills, loadAgentSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch marketplace when the debounced query changes.
  useEffect(() => {
    void loadMarketplace({ reset: true });
  }, [debouncedQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key handler for modals
  useEffect(() => {
    if (!selected) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setMarketplaceDetail(null);
        setInstalledDetail(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected]);

  useEffect(() => {
    if (selected?.kind === "market") {
      setInstalledDetail(null);
      void window.marloues.skill
        .marketplaceDetail(selected.slug)
        .then(setMarketplaceDetail)
        .catch((err) => {
          setMarketplaceDetail(null);
          setError(err instanceof Error ? err.message : "加载 Skill 详情失败");
        });
      return;
    }
    if (selected?.kind === "installed") {
      setMarketplaceDetail(null);
      void window.marloues.skill
        .getDetail(selected.id)
        .then(setInstalledDetail)
        .catch((err) => {
          setInstalledDetail(null);
          setError(err instanceof Error ? err.message : "加载 Skill 详情失败");
        });
    }
  }, [selected]);

  useEffect(() => {
    if (view !== "discover" || !hasMore || loading) return;
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting))
          void loadMarketplace({ reset: false });
      },
      { rootMargin: "180px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loadMarketplace, loading, view]);

  async function installMarketplaceSkill(slug: string, version?: string) {
    if (installingSlug) return;
    setInstallingSlug(slug);
    try {
      const next = await window.marloues.skill.marketplaceInstall(
        slug,
        version,
      );
      setSkills(next);
      setMarketplaceSkills((items) =>
        items.map((i) => (i.slug === slug ? { ...i, installed: true } : i)),
      );
      setMarketplaceDetail((d) =>
        d?.slug === slug ? { ...d, installed: true } : d,
      );
      notify({
        title: "Skill 已安装",
        description: `${slug}${version ? ` v${version}` : ""}`,
        tone: "success",
      });
    } catch (err) {
      notify({
        title: "安装 Skill 失败",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setInstallingSlug(null);
    }
  }
  async function removeInstalledSkill(skill: SkillInfo) {
    if (!skill.removable || removingSkillId) return;
    setRemovingSkillId(skill.id);
    try {
      const next = await window.marloues.skill.remove(skill.id);
      setSkills(next);
      setInstalledDetail(null);
      setSelected(null);
      if (skill.scope === "marketplace") {
        setMarketplaceSkills((items) =>
          items.map((i) =>
            i.slug === skill.name ? { ...i, installed: false } : i,
          ),
        );
        setMarketplaceDetail((d) =>
          d?.slug === skill.name ? { ...d, installed: false } : d,
        );
      }
      notify({
        title: "Skill 已删除",
        description: skill.name,
        tone: "success",
      });
    } catch (err) {
      notify({
        title: "删除 Skill 失败",
        description: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setRemovingSkillId(null);
    }
  }

  const handleToggleSkill = useCallback(async (skill: SkillInfo) => {
    setSkills(await window.marloues.skill.toggle(skill.id, !skill.enabled));
  }, []);

  const handleCloseModal = useCallback(() => {
    setSelected(null);
    setMarketplaceDetail(null);
    setInstalledDetail(null);
  }, []);

  const list =
    view === "discover" ? marketplaceSkills : filteredInstalledSkills;
  const resultLabel =
    view === "discover"
      ? `${formatMarketplaceResultsLabel(marketplaceSkills.length, total)}`
      : `${filteredInstalledSkills.length} 个 Skills`;

  const isGrid = marketplaceView === "grid";

  return (
    <div
      data-testid="skill-marketplace-page"
      className="skill-marketplace-page"
    >
      <div className="toolbar">
        <form className="search" onSubmit={handleSearchSubmit}>
          <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-text-muted"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="搜索 Skill 名称、作者或描述"
          />
          {query ? (
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-text-muted hover:text-text-normal"
              onClick={() => {
                handleQueryChange("");
                if (searchTimeoutRef.current) {
                  clearTimeout(searchTimeoutRef.current);
                  searchTimeoutRef.current = null;
                }
                setDebouncedQuery("");
              }}
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          ) : null}
        </form>
        <div className="subseg">
          <SegmentButton
            active={view === "discover"}
            onClick={() => setView("discover")}
          >
            发现
          </SegmentButton>
          <SegmentButton
            active={view === "installed"}
            onClick={() => setView("installed")}
          >
            已安装
          </SegmentButton>
        </div>
        <button
          className="plugin-refresh-button"
          type="button"
          aria-label="刷新插件"
          onClick={() => void refreshCurrentView()}
        >
          <RefreshCcw className={loading ? "is-spinning" : ""} />
        </button>
        <button
          className="plugin-local-import-button"
          type="button"
          onClick={() => {
            setLocalImportError(null);
            setLocalImportPreview(null);
            setLocalImportOpen(true);
          }}
        >
          <Upload /> 本地导入
        </button>
      </div>

      {error ? (
        <div className="plugin-inline-message" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={() => setError(null)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="plugin-results-scroll" aria-busy={loading}>
        <div className="resbar">
          <span>
            {view === "discover" ? "发现" : "已安装"} · {resultLabel}
          </span>
          <span className="view">
            <button
              aria-pressed={marketplaceView === "list"}
              className="viewbtn"
              type="button"
              title="列表视图"
              aria-label="列表视图"
              onClick={() => setMarketplaceView("list")}
            >
              <ListIcon />
            </button>
            <button
              aria-pressed={marketplaceView === "grid"}
              className="viewbtn"
              type="button"
              title="卡片视图"
              aria-label="卡片视图"
              onClick={() => setMarketplaceView("grid")}
            >
              <LayoutGrid />
            </button>
          </span>
        </div>
        {loading && list.length === 0 ? (
          <SkillListSkeleton isGrid={isGrid} />
        ) : null}
        {!loading && list.length === 0 ? <SkillListEmpty view={view} /> : null}
        <div className={`plugin-card-grid${isGrid ? "" : " is-list"}`}>
          {view === "discover"
            ? marketplaceSkills.map((skill) => (
                <SkillMarketplaceCard
                  key={skill.slug}
                  skill={skill}
                  layout={marketplaceView}
                  selected={
                    selected?.kind === "market" && selected.slug === skill.slug
                  }
                  installingSlug={installingSlug}
                  onSelect={(slug) => setSelected({ kind: "market", slug })}
                  onInstall={(slug) => void installMarketplaceSkill(slug)}
                />
              ))
            : filteredInstalledSkills.map((skill) => (
                <SkillInstalledCard
                  key={skill.id}
                  skill={skill}
                  layout={marketplaceView}
                  selected={
                    selected?.kind === "installed" && selected.id === skill.id
                  }
                  canToggle={canToggleSkills}
                  removingSkillId={removingSkillId}
                  onSelect={(id) => setSelected({ kind: "installed", id })}
                  onRemove={(s) => void removeInstalledSkill(s)}
                  onToggle={handleToggleSkill}
                />
              ))}
          {view === "discover" && hasMore ? (
            <div ref={loadMoreRef} className="h-4" />
          ) : null}
        </div>
      </div>

      {selected &&
      (selected.kind === "market"
        ? marketplaceDetail || selectedMarketplaceSkill
        : installedDetail || selectedInstalledSkill) ? (
        <SkillDetailModal
          key={`${selected.kind}:${selected.kind === "market" ? selected.slug : selected.id}`}
          kind={selected.kind}
          detail={
            selected.kind === "market" ? marketplaceDetail : installedDetail
          }
          skill={
            selected.kind === "market"
              ? selectedMarketplaceSkill
              : selectedInstalledSkill
          }
          installingSlug={installingSlug}
          onClose={handleCloseModal}
          onUse={() => onClose?.()}
          onInstall={(slug, version) =>
            void installMarketplaceSkill(slug, version)
          }
        />
      ) : null}

      {localImportOpen ? (
        <SkillLocalImportDialog
          preview={localImportPreview}
          busy={localImportBusy}
          error={localImportError}
          onSelect={() => void selectLocalSkill()}
          onImport={() => void importLocalSkill()}
          onClose={() => {
            if (localImportBusy) return;
            setLocalImportOpen(false);
            setLocalImportPreview(null);
            setLocalImportError(null);
          }}
        />
      ) : null}
    </div>
  );
}
