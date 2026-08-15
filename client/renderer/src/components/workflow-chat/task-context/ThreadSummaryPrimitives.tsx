import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { CONVERSATION_PAGE_CONTRACT } from "@shared/conversation-page-contract";

const SUMMARY_CONTRACT = CONVERSATION_PAGE_CONTRACT.threadSummary;

export function ThreadSummarySection({
  sectionKey,
  sessionId,
  title,
  count,
  autoCollapse = false,
  after,
  children,
}: {
  sectionKey: string;
  sessionId: string | null;
  title: string;
  count?: number;
  autoCollapse?: boolean;
  after?: ReactNode;
  children: ReactNode;
}) {
  const storageKey = `${SUMMARY_CONTRACT.expansionStateKeyPrefix}${sessionId ?? "none"}:${sectionKey}`;
  const [expanded, setExpanded] = useState(true);
  const [autoCollapseCancelled, setAutoCollapseCancelled] = useState(false);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(storageKey);
    setExpanded(stored === null ? true : stored === "true");
    setAutoCollapseCancelled(false);
  }, [storageKey]);

  useEffect(() => {
    if (!autoCollapse || !expanded || autoCollapseCancelled) return undefined;
    const timer = window.setTimeout(() => {
      setExpanded(false);
      window.sessionStorage.setItem(storageKey, "false");
    }, SUMMARY_CONTRACT.sectionAutoCollapseMs);
    return () => window.clearTimeout(timer);
  }, [autoCollapse, autoCollapseCancelled, expanded, storageKey]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    setAutoCollapseCancelled(true);
    window.sessionStorage.setItem(storageKey, String(next));
  };

  return (
    <section
      className="thread-summary-section"
      data-section-key={sectionKey}
      data-expanded={expanded || undefined}
    >
      <header className="thread-summary-section-header">
        <button
          type="button"
          className="thread-summary-section-toggle"
          aria-expanded={expanded}
          onClick={toggle}
        >
          <span>{title}</span>
          {expanded || count === undefined ? null : <small>{count}</small>}
          <ChevronRight size={12} aria-hidden="true" />
        </button>
        {after ? (
          <div className="thread-summary-section-actions">{after}</div>
        ) : null}
      </header>
      {expanded ? (
        <div className="thread-summary-section-content">{children}</div>
      ) : null}
    </section>
  );
}

export function ThreadSummaryExpandableList<T>({
  items,
  scopeKey,
  ariaLabel,
  getKey,
  renderItem,
}: {
  items: readonly T[];
  scopeKey: string;
  ariaLabel: string;
  getKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const [visibleCount, setVisibleCount] = useState<number>(
    SUMMARY_CONTRACT.initialVisibleItems,
  );

  useEffect(() => {
    setVisibleCount(SUMMARY_CONTRACT.initialVisibleItems);
  }, [scopeKey]);

  const visible = items.slice(0, visibleCount);
  const remaining = Math.max(0, items.length - visible.length);
  const fullyExpanded = remaining === 0;
  const expandable = items.length > SUMMARY_CONTRACT.initialVisibleItems;

  return (
    <>
      <div className="thread-summary-list" role="list" aria-label={ariaLabel}>
        {visible.map((item, index) => (
          <Fragment key={getKey(item)}>
            <div role="listitem">{renderItem(item, index)}</div>
          </Fragment>
        ))}
      </div>
      {expandable ? (
        <button
          type="button"
          className="thread-summary-list-more"
          onClick={() =>
            setVisibleCount((current) =>
              fullyExpanded
                ? SUMMARY_CONTRACT.initialVisibleItems
                : Math.min(
                    items.length,
                    current + SUMMARY_CONTRACT.revealBatchSize,
                  ),
            )
          }
        >
          {fullyExpanded
            ? "收起"
            : `再显示 ${Math.min(remaining, SUMMARY_CONTRACT.revealBatchSize)} 项`}
        </button>
      ) : null}
    </>
  );
}
