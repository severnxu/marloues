import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Plus,
  X,
} from "lucide-react";
import {
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  nextImageZoom,
} from "./image-lightbox-model";

export type WorkflowImagePreview = { src: string; name: string };

export function WorkflowImageLightbox({
  image,
  images = [],
  onNavigate,
  onClose,
}: {
  image: WorkflowImagePreview | null;
  images?: WorkflowImagePreview[];
  onNavigate?: (image: WorkflowImagePreview) => void;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const gallery = useMemo(
    () => (image ? (images.length ? images : [image]) : []),
    [image, images],
  );
  const imageIndex = image
    ? gallery.findIndex((item) => item.src === image.src)
    : -1;
  const canNavigate = imageIndex >= 0 && gallery.length > 1;

  useEffect(() => {
    if (!image) return;
    const previousActive =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && canNavigate) {
        event.preventDefault();
        onNavigate?.(
          gallery[(imageIndex - 1 + gallery.length) % gallery.length],
        );
      }
      if (event.key === "ArrowRight" && canNavigate) {
        event.preventDefault();
        onNavigate?.(gallery[(imageIndex + 1) % gallery.length]);
      }
      if (event.key !== "Tab") return;
      const focusables = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousActive?.isConnected) previousActive.focus();
    };
  }, [canNavigate, gallery, image, imageIndex, onClose, onNavigate]);

  useEffect(() => setZoom(100), [image?.src]);
  if (!image) return null;

  const navigate = (offset: number) => {
    if (!canNavigate) return;
    onNavigate?.(
      gallery[(imageIndex + offset + gallery.length) % gallery.length],
    );
  };

  return createPortal(
    <div
      className="image-lightbox-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={image.name}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="image-lightbox-actions">
          <a
            className="image-lightbox-action"
            href={image.src}
            download={image.name}
            aria-label="下载图片"
            title="下载图片"
          >
            <Download />
          </a>
          <button
            ref={closeButtonRef}
            type="button"
            className="image-lightbox-action"
            onClick={onClose}
            aria-label="关闭图片预览"
            title="关闭"
          >
            <X />
          </button>
        </div>
        <div className="image-lightbox-stage" aria-label={image.name}>
          {canNavigate ? (
            <button
              type="button"
              className="image-lightbox-nav image-lightbox-nav-prev"
              onClick={() => navigate(-1)}
              aria-label="上一张图片"
            >
              <ChevronLeft />
            </button>
          ) : null}
          <img
            src={image.src}
            alt={image.name}
            style={{ transform: `scale(${zoom / 100})` }}
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              setZoom((current) =>
                nextImageZoom(current, event.deltaY < 0 ? "in" : "out"),
              );
            }}
          />
          {canNavigate ? (
            <button
              type="button"
              className="image-lightbox-nav image-lightbox-nav-next"
              onClick={() => navigate(1)}
              aria-label="下一张图片"
            >
              <ChevronRight />
            </button>
          ) : null}
        </div>
        <div className="image-lightbox-zoom" aria-label="图片缩放控件">
          <button
            type="button"
            className="image-lightbox-zoom-button"
            onClick={() => setZoom((current) => nextImageZoom(current, "out"))}
            disabled={zoom <= IMAGE_ZOOM_MIN}
            aria-label="缩小图片"
          >
            <Minus />
          </button>
          <span className="image-lightbox-zoom-value">{zoom}%</span>
          <button
            type="button"
            className="image-lightbox-zoom-button"
            onClick={() => setZoom((current) => nextImageZoom(current, "in"))}
            disabled={zoom >= IMAGE_ZOOM_MAX}
            aria-label="放大图片"
          >
            <Plus />
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
