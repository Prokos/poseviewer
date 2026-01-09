import { useRef } from 'react';
import type { MutableRefObject, PointerEventHandler } from 'react';
import { createProxyThumbUrl } from '../utils/driveUrls';

type ImageThumbProps = {
  isConnected: boolean;
  fileId: string;
  alt: string;
  size: number;
  thumbPos?: number;
  hoverScroll?: boolean;
  containerRef?: MutableRefObject<HTMLDivElement | null>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: PointerEventHandler<HTMLDivElement>;
};

export function ImageThumb({
  isConnected,
  fileId,
  alt,
  size,
  thumbPos,
  hoverScroll = true,
  containerRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: ImageThumbProps) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const resolvedRef = containerRef ?? localRef;
  const resolvedPos = thumbPos ?? 50;
  const setRef = (node: HTMLDivElement | null) => {
    localRef.current = node;
    if (containerRef) {
      containerRef.current = node;
    }
  };
  if (!fileId) {
    return <div className="thumb thumb--empty">No thumbnail</div>;
  }

  if (!isConnected) {
    return <div className="thumb thumb--empty">Connect to load</div>;
  }

  return (
    <div
      className={`thumb`}
      ref={setRef}
      style={{ ['--thumb-pos' as string]: `${resolvedPos}%` }}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onMouseMove={
        hoverScroll
          ? (event) => {
              const bounds = resolvedRef.current?.getBoundingClientRect();
              if (!bounds) {
                return;
              }
              const y = event.clientY - bounds.top;
              const raw = y / bounds.height;
              const clamped = Math.min(1, Math.max(0, raw));
              const start = 0.2;
              const end = 0.8;
              let percent = 0;
              if (clamped <= start) {
                percent = 0;
              } else if (clamped >= end) {
                percent = 100;
              } else {
                percent = ((clamped - start) / (end - start)) * 100;
              }
              resolvedRef.current?.style.setProperty('--thumb-pos', `${percent}%`);
            }
          : undefined
      }
      onMouseLeave={
        hoverScroll
          ? () => {
              resolvedRef.current?.style.setProperty('--thumb-pos', `${resolvedPos}%`);
            }
          : undefined
      }
    >
      <img
        src={createProxyThumbUrl(fileId, size)}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </div>
  );
}
