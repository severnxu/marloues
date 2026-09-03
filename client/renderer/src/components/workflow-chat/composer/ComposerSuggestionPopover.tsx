import { useEffect, useRef } from "react";
import { FileText, Wrench } from "lucide-react";
import type { SkillInfo } from "@shared/types";

export type ComposerSuggestion =
  | {
      kind: "skill";
      id: string;
      label: string;
      detail?: string;
      skill: SkillInfo;
    }
  | {
      kind: "mention";
      id: string;
      label: string;
      detail?: string;
      path: string;
    };

export function ComposerSuggestionPopover({
  items,
  selectedIndex,
  onSelect,
}: {
  items: ComposerSuggestion[];
  selectedIndex: number;
  onSelect: (item: ComposerSuggestion) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  if (!items.length) return null;
  return (
    <div
      className="slash-command-popover composer-suggestion-popover"
      role="listbox"
      aria-label="输入建议"
    >
      <div className="slash-command-list">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={index === selectedIndex ? selectedRef : null}
            type="button"
            role="option"
            aria-selected={index === selectedIndex}
            className={`slash-command-item${index === selectedIndex ? " is-selected" : ""}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
          >
            <span className="slash-command-name">
              {item.kind === "skill" ? (
                <Wrench size={14} />
              ) : (
                <FileText size={14} />
              )}
              <span>
                {item.kind === "skill" ? `$${item.label}` : `@${item.label}`}
              </span>
            </span>
            {item.detail ? (
              <span className="slash-command-description">{item.detail}</span>
            ) : null}
            <span className="slash-command-category">
              {item.kind === "skill" ? "Skill" : "File"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
