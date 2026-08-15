import { useState } from "react";
import { X } from "lucide-react";
import styles from "./SchedulePage.module.css";

export function ScheduleTagInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const tag = draft.trim();
    if (!tag || value.length >= 3 || value.includes(tag)) return;
    onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div className={styles.scheduledTagControl}>
      {value.map((tag) => (
        <button
          key={tag}
          type="button"
          className={styles.scheduledTagChip}
          title={`移除标签 ${tag}`}
          onClick={() => onChange(value.filter((item) => item !== tag))}
        >
          <span>{tag}</span>
          <X size={12} />
        </button>
      ))}
      <input
        data-role="scheduled-tag-input"
        value={draft}
        maxLength={12}
        disabled={value.length >= 3}
        aria-label="添加任务标签"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
          if (event.key === "Backspace" && !draft && value.length)
            onChange(value.slice(0, -1));
        }}
      />
      <small className={styles.scheduledTagCount}>{value.length}/3</small>
    </div>
  );
}
