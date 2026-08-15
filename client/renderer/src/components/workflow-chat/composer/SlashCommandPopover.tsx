import { useEffect, useRef, type RefObject } from "react";
import type { SlashCommandItem } from "../../../types";

const MAX_VISIBLE_ROWS = 8;
const ROW_HEIGHT = 38;

const CATEGORY_LABEL: Record<SlashCommandItem["category"], string> = {
  skill: "Skill",
  builtin: "Command",
};

interface SlashCommandPopoverProps {
  items: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (item: SlashCommandItem) => void;
  onClose: () => void;
  popoverRef: RefObject<HTMLDivElement | null>;
}

export function SlashCommandPopover({
  items,
  selectedIndex,
  onSelect,
  onClose,
  popoverRef,
}: SlashCommandPopoverProps) {
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, popoverRef]);

  if (items.length === 0) return null;

  // Build rows with category headers
  const rows: Array<
    | { type: "header"; category: SlashCommandItem["category"] }
    | { type: "item"; item: SlashCommandItem; index: number }
  > = [];
  let lastCategory: SlashCommandItem["category"] | null = null;
  items.forEach((item, idx) => {
    if (item.category !== lastCategory) {
      rows.push({ type: "header", category: item.category });
      lastCategory = item.category;
    }
    rows.push({ type: "item", item, index: idx });
  });

  return (
    <div
      ref={(node) => {
        (popoverRef as { current: HTMLDivElement | null }).current = node;
      }}
      className="slash-command-popover"
      role="listbox"
      aria-label="斜杠命令"
    >
      <div
        className="slash-command-list"
        style={{ maxHeight: `${MAX_VISIBLE_ROWS * ROW_HEIGHT}px` }}
      >
        {rows.map((row, rowIdx) => {
          if (row.type === "header") {
            return (
              <div
                key={`header-${rowIdx}`}
                className="slash-command-group-label"
                role="presentation"
              >
                {CATEGORY_LABEL[row.category]}
              </div>
            );
          }
          const { item, index } = row;
          const isSelected = index === selectedIndex;
          return (
            <button
              key={item.id}
              ref={isSelected ? selectedRowRef : null}
              type="button"
              role="option"
              aria-selected={isSelected}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
              className={`slash-command-item ${isSelected ? "is-selected" : ""}`}
              style={{ minHeight: `${ROW_HEIGHT}px` }}
            >
              <span className="slash-command-name">
                <span>{item.command}</span>
                {item.argumentHint ? (
                  <span className="slash-command-argument">
                    {item.argumentHint}
                  </span>
                ) : null}
              </span>
              {item.description ? (
                <span className="slash-command-description">
                  {item.description}
                </span>
              ) : null}
              <span className="slash-command-category">
                {CATEGORY_LABEL[item.category]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
