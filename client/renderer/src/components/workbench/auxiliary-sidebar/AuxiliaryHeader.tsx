import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, Plus, X } from "lucide-react";
import type { AuxiliaryHeaderTab, AuxiliaryViewOption } from "./types";
import { auxiliaryPanelDomId, auxiliaryTabDomId } from "./types";

export function AuxiliaryHeader({
  open,
  primary,
  tabs,
  availableViews,
  onActivate,
  onCloseTab,
  onMoveTab,
  onOpenView,
  onTogglePrimary,
}: {
  open: boolean;
  primary: boolean;
  tabs: readonly AuxiliaryHeaderTab[];
  availableViews: readonly AuxiliaryViewOption[];
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onMoveTab: (from: number, to: number) => void;
  onOpenView: (type: AuxiliaryViewOption["type"]) => void;
  onTogglePrimary: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ top: 0, left: 0 });
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const hasTabs = tabs.length > 0;

  useEffect(() => {
    if (!open || !hasTabs || availableViews.length === 0) {
      setPickerOpen(false);
    }
  }, [availableViews.length, hasTabs, open]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPickerOpen(false);
      requestAnimationFrame(() => addButtonRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pickerOpen]);

  const togglePicker = () => {
    if (!pickerOpen && addButtonRef.current) {
      const rect = addButtonRef.current.getBoundingClientRect();
      setPickerPosition({ top: rect.bottom + 8, left: rect.right });
    }
    setPickerOpen((value) => !value);
  };

  const focusTab = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    onActivate(tab.id);
    requestAnimationFrame(() =>
      document.getElementById(auxiliaryTabDomId(tab.id))?.focus(),
    );
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusTab((index + 1) % tabs.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusTab((index - 1 + tabs.length) % tabs.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(tabs.length - 1);
    }
  };

  return (
    <header
      className={`inspector-tabs auxiliary-header ${hasTabs ? "" : "is-empty"}`}
    >
      {hasTabs ? (
        <div className="inspector-tabstrip">
          <div
            className="inspector-tabs-scroll"
            role="tablist"
            aria-label="已打开的辅助视图"
          >
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              return (
                <div
                  key={tab.id}
                  className={`inspector-tab ${tab.selected ? "active" : ""}`}
                  draggable
                  onDragStart={() => {
                    dragRef.current = { from: index, to: index };
                  }}
                  onDragOver={(event: DragEvent<HTMLDivElement>) => {
                    event.preventDefault();
                    if (dragRef.current) dragRef.current.to = index;
                  }}
                  onDragEnd={() => {
                    const drag = dragRef.current;
                    dragRef.current = null;
                    if (drag && drag.from !== drag.to) {
                      onMoveTab(drag.from, drag.to);
                    }
                  }}
                >
                  <button
                    id={auxiliaryTabDomId(tab.id)}
                    data-tab-id={tab.id}
                    className="inspector-tab-main"
                    type="button"
                    role="tab"
                    aria-selected={tab.selected}
                    aria-controls={auxiliaryPanelDomId(tab.id)}
                    tabIndex={tab.selected ? 0 : -1}
                    title={tab.label}
                    onClick={() => onActivate(tab.id)}
                    onKeyDown={(event) => handleTabKeyDown(event, index)}
                  >
                    <Icon size={14} />
                    <span className="inspector-tab-label">{tab.label}</span>
                  </button>
                  <button
                    className="inspector-tab-close"
                    type="button"
                    onClick={() => onCloseTab(tab.id)}
                    title={`关闭${tab.label}视图`}
                    aria-label={`关闭${tab.label}视图`}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          <button
            ref={addButtonRef}
            id="auxiliary-add-view"
            className="inspector-tab-add"
            type="button"
            disabled={availableViews.length === 0}
            onClick={togglePicker}
            title="添加辅助视图"
            aria-label="添加辅助视图"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            aria-controls="auxiliary-view-picker"
          >
            <Plus size={14} />
          </button>
          <span className="inspector-action-divider" aria-hidden="true" />
        </div>
      ) : null}

      <div className="inspector-fixed-actions">
        <button
          className="inspector-head-action"
          type="button"
          onClick={onTogglePrimary}
          title={primary ? "收回辅助区至右栏" : "展开辅助区至主视图区"}
          aria-label={primary ? "收回辅助区至右栏" : "展开辅助区至主视图区"}
        >
          {primary ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>

      {pickerOpen
        ? createPortal(
            <>
              <div
                className="inspector-tab-menu-overlay"
                onClick={() => setPickerOpen(false)}
              />
              <div
                id="auxiliary-view-picker"
                className="inspector-tab-menu"
                style={pickerPosition}
                role="menu"
                aria-label="添加辅助视图"
              >
                {availableViews.map((view) => {
                  const Icon = view.icon;
                  return (
                    <button
                      key={view.type}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onOpenView(view.type);
                        setPickerOpen(false);
                      }}
                    >
                      <Icon size={14} />
                      <span>{view.label}</span>
                    </button>
                  );
                })}
              </div>
            </>,
            document.body,
          )
        : null}
    </header>
  );
}
