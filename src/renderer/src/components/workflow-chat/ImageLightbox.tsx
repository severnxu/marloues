import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Minus, Plus, X } from 'lucide-react'

export type WorkflowImagePreview = {
  src: string
  name: string
}

export function WorkflowImageLightbox({
  image,
  onClose,
}: {
  image: WorkflowImagePreview | null
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(100)

  useEffect(() => {
    if (!image) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [image, onClose])

  useEffect(() => {
    setZoom(100)
  }, [image?.src])

  if (!image) return null

  const zoomOut = () => setZoom(current => Math.max(25, current - 25))
  const zoomIn = () => setZoom(current => Math.min(300, current + 25))

  return createPortal(
    <div className="image-lightbox-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={image.name}
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="image-lightbox-actions">
          <a
            className="image-lightbox-action"
            href={image.src}
            download={image.name}
            aria-label="Download image"
            title="Download"
          >
            <Download size={17} />
          </a>
          <button
            type="button"
            className="image-lightbox-action"
            onClick={onClose}
            aria-label="Close image preview"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="image-lightbox-stage" aria-label={image.name}>
          <img src={image.src} alt={image.name} style={{ transform: `scale(${zoom / 100})` }} />
        </div>
        <div className="image-lightbox-zoom" aria-label="Image zoom controls">
          <button
            type="button"
            className="image-lightbox-zoom-button"
            onClick={zoomOut}
            disabled={zoom <= 25}
            aria-label="Zoom out"
          >
            <Minus size={18} />
          </button>
          <span className="image-lightbox-zoom-value">{zoom}%</span>
          <button
            type="button"
            className="image-lightbox-zoom-button"
            onClick={zoomIn}
            disabled={zoom >= 300}
            aria-label="Zoom in"
          >
            <Plus size={18} />
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}