import { useEffect, useState } from 'react';

type SourceThumbProps = {
  url: string | null;
  alt: string;
  eager?: boolean;
};

export function SourceThumb({ url, alt, eager = false }: SourceThumbProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [url]);

  if (!url) {
    return <div className="thumb thumb--empty">No thumbnail</div>;
  }

  return (
    <div
      className={`thumb${isLoaded && !hasError ? ' is-loaded' : ''}${
        !isLoaded && !hasError ? ' is-pending' : ''
      }${hasError ? ' is-error' : ''}`}
      onDragStart={(event) => event.preventDefault()}
    >
      {!hasError ? (
        <img
          src={url}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setIsLoaded(true)}
          onError={() => setHasError(true)}
        />
      ) : null}
    </div>
  );
}
