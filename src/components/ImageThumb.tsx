import { useRef } from 'react';
import { createProxyThumbUrl } from '../utils/driveUrls';

type ImageThumbProps = {
  isConnected: boolean;
  fileId: string;
  alt: string;
  size: number;
};

export function ImageThumb({ isConnected, fileId, alt, size }: ImageThumbProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  if (!fileId) {
    return <div className="thumb thumb--empty">No thumbnail</div>;
  }

  if (!isConnected) {
    return <div className="thumb thumb--empty">Connect to load</div>;
  }

  return (
    <div
      className="thumb"
      ref={containerRef}
      onMouseMove={(event) => {
        const bounds = containerRef.current?.getBoundingClientRect();
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
        containerRef.current?.style.setProperty('--thumb-pos', `${percent}%`);
      }}
      onMouseLeave={() => {
        containerRef.current?.style.setProperty('--thumb-pos', '50%');
      }}
    >
      <img src={createProxyThumbUrl(fileId, size)} alt={alt} loading="lazy" decoding="async" />
    </div>
  );
}
