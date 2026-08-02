import { useRef, useState, type DragEvent } from "react";
import { GripVertical, MoreHorizontal, Trash2, Undo2 } from "lucide-react";
import type { SteerItem } from "./types";

export function SteerQueue({
  items,
  onGuide,
  onEdit,
  onRemove,
  onReorder,
}: {
  items: SteerItem[];
  onGuide: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
  const draggedIdRef = useRef<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  if (items.length === 0) return null;

  return (
    <section className="steer-queue" aria-label={`${items.length} 条等待引导`}>
      {items.map((item) => (
        <article
          key={item.id}
          className="steer-row"
          draggable
          onDragStart={() => {
            draggedIdRef.current = item.id;
          }}
          onDragOver={(event: DragEvent<HTMLElement>) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const fromId = draggedIdRef.current;
            draggedIdRef.current = null;
            if (fromId && fromId !== item.id) onReorder(fromId, item.id);
          }}
        >
          <GripVertical className="steer-grip" size={14} aria-hidden="true" />
          <button
            type="button"
            className="steer-copy"
            onClick={() => onEdit(item.id)}
          >
            {item.text || `${item.attachments.length} 个附件`}
          </button>
          <button
            type="button"
            className="steer-guide"
            onClick={() => onGuide(item.id)}
          >
            <Undo2 size={13} />
            引导
          </button>
          <button
            type="button"
            className="steer-icon-button"
            onClick={() => onRemove(item.id)}
            aria-label="删除等待引导"
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            className="steer-icon-button"
            onClick={() =>
              setMenuId((value) => (value === item.id ? null : item.id))
            }
            aria-label="更多操作"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuId === item.id ? (
            <div className="steer-menu">
              <button type="button" onClick={() => onEdit(item.id)}>
                编辑并放回输入框
              </button>
              <button type="button" onClick={() => onRemove(item.id)}>
                删除
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}
