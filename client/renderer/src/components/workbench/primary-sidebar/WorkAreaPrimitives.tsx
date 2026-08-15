import { ChevronRight, Folder, FolderOpen, Pin, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SidebarActivityIndicator } from "./SidebarActivityIndicator";
import type { SidebarActivityStatus } from "./sidebar-activity";

export function WorkspaceArea({
  areaId,
  label,
  expanded,
  activity,
  onToggle,
  onAdd,
  children,
}: {
  areaId: string;
  label: string;
  expanded: boolean;
  activity?: SidebarActivityStatus;
  onToggle: () => void;
  onAdd?: () => void;
  children?: ReactNode;
}) {
  const [actionsPinned, setActionsPinned] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!actionsPinned) return;
    const unpin = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setActionsPinned(false);
    };
    document.addEventListener("mousedown", unpin);
    return () => document.removeEventListener("mousedown", unpin);
  }, [actionsPinned]);

  return (
    <section
      ref={rootRef}
      className={`work-area work-area-${areaId} ${expanded ? "is-expanded" : ""} ${actionsPinned ? "is-actions-pinned" : ""}`}
      data-work-area={areaId}
    >
      <div className="work-area-heading">
        <button
          className="work-area-row"
          type="button"
          onClick={() => {
            if (onAdd) setActionsPinned(true);
            onToggle();
          }}
          aria-expanded={expanded}
        >
          <span className="work-area-label">{label}</span>
          <ChevronRight className="work-area-chevron" aria-hidden="true" />
          {!expanded ? (
            <SidebarActivityIndicator
              status={activity ?? null}
              className="work-area-activity"
            />
          ) : null}
        </button>
        {onAdd ? (
          <button
            className="work-area-add"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setActionsPinned(true);
              onAdd();
            }}
            title="添加项目"
            aria-label="添加项目"
          >
            <Plus aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {expanded && children ? (
        <div className="work-area-children">{children}</div>
      ) : null}
    </section>
  );
}

export function WorkAreaProjectRow({
  name,
  expanded,
  activity,
  title,
  onToggle,
  actions,
  children,
}: {
  name: string;
  expanded: boolean;
  activity?: SidebarActivityStatus;
  title?: string;
  onToggle: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`work-area-project ${expanded ? "is-expanded" : ""}`}>
      <div className="project-row" title={title}>
        <button
          className="project-row-main"
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <span className="project-icon-slot" aria-hidden="true">
            {expanded ? <FolderOpen /> : <Folder />}
          </span>
          <strong className="project-row-name">{name}</strong>
        </button>
        {!expanded ? (
          <SidebarActivityIndicator
            status={activity ?? null}
            className="project-activity-indicator"
          />
        ) : null}
        {actions ? (
          <span className="project-row-actions">{actions}</span>
        ) : null}
      </div>
      {expanded && children ? (
        <div className="work-area-leaves">{children}</div>
      ) : null}
    </div>
  );
}

export function WorkAreaLeafRow({
  title,
  time,
  active = false,
  pinned = false,
  activity = null,
  onOpen,
}: {
  title: string;
  time?: string;
  active?: boolean;
  pinned?: boolean;
  activity?: SidebarActivityStatus;
  onOpen: () => void;
}) {
  return (
    <button
      className={`work-area-leaf ${active ? "active" : ""} ${pinned ? "pinned" : ""}`}
      type="button"
      onClick={onOpen}
      aria-current={active ? "page" : undefined}
    >
      {pinned ? (
        <span className="session-pinned-indicator" aria-label="已置顶">
          <Pin aria-hidden="true" />
        </span>
      ) : null}
      <span className="work-area-leaf-title">{title}</span>
      <span className="work-area-leaf-trailing">
        {activity ? (
          <SidebarActivityIndicator status={activity} />
        ) : time ? (
          <time>{time}</time>
        ) : null}
      </span>
    </button>
  );
}
