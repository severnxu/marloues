/**
 * QueuedSteersPanel - steer 排队队列组件。
 *
 * 把排队的 steer 组织成一个内聚容器（"包在一个组件内"），浮在输入框外上方，
 * 支持 HTML5 拖拽排序。排序即注入顺序：拖拽后调 onReorder 同步到 store 与 main。
 *
 * 拖拽模式复用辅助标签栏的 dragRef + splice（HTML5 原生，无第三方库）。
 */

import { useEffect, useRef, useState } from "react";
import {
  CornerDownLeft,
  FileText,
  Image,
  Link,
  Pencil,
  GripVertical,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Trash2,
  X,
} from "lucide-react";
import type { PendingSteerPreview } from "@/stores/unified-chat-store";

interface QueuedSteersPanelProps {
  pendingSteers: PendingSteerPreview[];
  /** 队列因用户中断而暂停（路径④）：显示横幅 + 继续按钮。 */
  paused?: boolean;
  onApply?: (messageId: string) => void;
  onCancel?: (messageId: string) => void;
  onEdit?: (messageId: string, text: string) => void;
  /** 拖拽结束后的新顺序（完整 id 列表），由上层绑定 sessionId 调 store.reorderSteers。 */
  onReorder?: (orderedIds: string[]) => void;
  /** 暂停状态下点“继续”：恢复既有 steer 队列的运行。 */
  onResume?: () => void;
}

export function QueuedSteersPanel({
  pendingSteers,
  paused = false,
  onApply,
  onCancel,
  onEdit,
  onReorder,
  onResume,
}: QueuedSteersPanelProps) {
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuId) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenuId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuId]);

  if (pendingSteers.length === 0) return null;

  const handleDragStart = (index: number) => {
    dragRef.current = { from: index, to: index };
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    if (dragRef.current) dragRef.current.to = index;
  };

  const handleDragEnd = () => {
    if (!dragRef.current) return;
    const { from, to } = dragRef.current;
    dragRef.current = null;
    if (from === to) return;
    const ids = pendingSteers.map((steer) => steer.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder?.(ids);
  };

  return (
    <div
      className="composer-steer-list"
      aria-label="排队中的引导消息"
      role="list"
    >
      {paused && pendingSteers.length > 0 ? (
        <div
          className="composer-steer-paused-banner"
          role="status"
          aria-label="队列因中断而暂停"
        >
          <span className="composer-steer-paused-text">队列因中断而暂停</span>
          <button
            type="button"
            className="composer-steer-resume"
            title="继续处理已暂停的引导队列"
            aria-label="继续队列"
            onClick={() => onResume?.()}
          >
            <Play size={12} aria-hidden="true" />
            <span>继续</span>
          </button>
        </div>
      ) : null}
      {pendingSteers.map((steer, index) => {
        const isApplying = steer.status === "applying";
        return (
          <div
            className={`composer-steer-card${isApplying ? " is-applying" : ""}`}
            key={steer.id}
            role="listitem"
            title="双击编辑引导消息，拖拽左侧手柄排序"
            onDoubleClick={() => onEdit?.(steer.id, steer.text)}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={(event) => handleDragOver(event, index)}
            onDragEnd={handleDragEnd}
          >
            <span
              className="composer-steer-grip"
              aria-label="拖拽排序"
              title="拖拽排序"
            >
              <GripVertical size={13} aria-hidden="true" />
            </span>
            <div className="composer-steer-text">
              <CornerDownLeft size={13} aria-hidden="true" />
              <span>{steer.text}</span>
            </div>
            {steer.attachments && steer.attachments.length > 0 && (
              <div className="composer-steer-attachments">
                {steer.attachments.map((att, i) => (
                  <span
                    key={i}
                    className="composer-steer-attachment-icon"
                    title={
                      att.type === "image"
                        ? "图片"
                        : att.type === "url"
                          ? att.url
                          : att.type === "file"
                            ? att.name
                            : att.type === "skill"
                              ? att.name
                              : att.type === "mention"
                                ? att.name
                                : ""
                    }
                  >
                    {att.type === "image" ? (
                      <Image size={12} aria-hidden="true" />
                    ) : att.type === "url" ? (
                      <Link size={12} aria-hidden="true" />
                    ) : (
                      <FileText size={12} aria-hidden="true" />
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="composer-steer-actions">
              <button
                type="button"
                className="composer-steer-guide"
                title={isApplying ? "正在引导" : "立即引导"}
                aria-label={isApplying ? "正在引导" : "立即引导"}
                disabled={isApplying}
                onClick={() => onApply?.(steer.id)}
              >
                {isApplying ? (
                  <LoaderCircle
                    size={12}
                    className="composer-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <CornerDownLeft size={12} aria-hidden="true" />
                )}
                <span>{isApplying ? "引导中" : "引导"}</span>
              </button>
              <button
                type="button"
                className="composer-steer-icon"
                title="删除"
                aria-label="删除"
                onClick={() => onCancel?.(steer.id)}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
              <div
                className="composer-steer-more"
                ref={openMenuId === steer.id ? menuRef : null}
              >
                <button
                  type="button"
                  className="composer-steer-icon"
                  title="更多操作"
                  aria-label="更多操作"
                  aria-expanded={openMenuId === steer.id}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpenMenuId((current) =>
                      current === steer.id ? null : steer.id,
                    );
                  }}
                >
                  <MoreHorizontal size={14} aria-hidden="true" />
                </button>
                {openMenuId === steer.id ? (
                  <div className="composer-steer-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setOpenMenuId(null);
                        onEdit?.(steer.id, steer.text);
                      }}
                    >
                      <Pencil size={13} aria-hidden="true" />
                      编辑
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => {
                        setOpenMenuId(null);
                        onCancel?.(steer.id);
                      }}
                    >
                      <X size={13} aria-hidden="true" />
                      关闭引导
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
