import { useState, type CSSProperties } from 'react';
import { resolveGeneratedVideoMedia } from '../lib/mediaThumbnail';

type GeneratedVideoPreviewProps = {
  item: unknown;
  title?: string | null;
  className?: string;
  style?: CSSProperties;
  fit?: CSSProperties['objectFit'];
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  forceVideo?: boolean;
  showCastBadge?: boolean;
  placeholderLabel?: string;
  onClick?: () => void;
};

export default function GeneratedVideoPreview({
  item,
  title,
  className,
  style,
  fit = 'cover',
  controls = false,
  autoPlay = false,
  loop = true,
  muted = true,
  preload = 'metadata',
  forceVideo = false,
  showCastBadge = true,
  placeholderLabel = 'Preview unavailable',
  onClick,
}: GeneratedVideoPreviewProps) {
  const [loaded, setLoaded] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const media = resolveGeneratedVideoMedia(item);
  const alt = title || 'Generated video preview';
  const useVideo = Boolean(media.videoUrl && !videoFailed && (forceVideo || posterFailed || !media.posterUrl || media.mainPreviewType === 'video'));
  const showPoster = Boolean(media.posterUrl && !useVideo && !posterFailed);

  const shellStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    background: 'var(--card-media-background)',
    display: 'block',
    ...style,
  };
  const mediaStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: fit,
    display: 'block',
    background: 'var(--media-background)',
  };

  return (
    <div className={className} style={shellStyle} onClick={onClick}>
      {!loaded && (showPoster || useVideo) ? (
        <div
          aria-hidden="true"
          className="cinematic-shimmer"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            background: 'var(--card-media-background)',
          }}
        />
      ) : null}

      {showPoster ? (
        <img
          src={media.posterUrl ?? undefined}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setPosterFailed(true);
            setLoaded(false);
          }}
          style={mediaStyle}
        />
      ) : useVideo && media.videoUrl ? (
        <video
          src={media.videoUrl}
          controls={controls}
          autoPlay={autoPlay}
          muted={muted}
          loop={loop}
          playsInline
          preload={preload}
          poster={media.posterUrl ?? undefined}
          onLoadedMetadata={() => setLoaded(true)}
          onCanPlay={() => setLoaded(true)}
          onError={() => setVideoFailed(true)}
          style={mediaStyle}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            minHeight: 'inherit',
            display: 'grid',
            placeItems: 'center',
            padding: '14px',
            color: 'var(--soft-text)',
            textAlign: 'center',
          }}
        >
          <strong>{placeholderLabel}</strong>
        </div>
      )}

      {showCastBadge && media.castBadgeUrl ? (
        <span
          aria-label="Cast reference"
          style={{
            position: 'absolute',
            right: '10px',
            bottom: '10px',
            width: '38px',
            height: '38px',
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.72)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
            background: 'var(--surface-strong)',
          }}
        >
          <img
            src={media.castBadgeUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </span>
      ) : null}
    </div>
  );
}
