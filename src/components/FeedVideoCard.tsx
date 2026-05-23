import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { resolveGeneratedVideoMedia } from '../lib/mediaThumbnail';

type FeedVideoCardProps = {
  item: unknown;
  title: string;
  caption?: string | null;
  creatorName?: string | null;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
  statsText?: string | null;
  badges?: string[];
  variant?: 'hero' | 'compact';
  autoPlayMuted?: boolean;
  onOpen?: () => void;
};

const CONTROL_HIDE_DELAY_MS = 1800;

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const handleChange = () => setReducedMotion(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reducedMotion;
}

export default function FeedVideoCard({
  item,
  title,
  caption,
  creatorName,
  creatorUsername,
  creatorAvatar,
  statsText,
  badges = [],
  variant = 'hero',
  autoPlayMuted = true,
  onOpen,
}: FeedVideoCardProps) {
  const media = resolveGeneratedVideoMedia(item);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);

  const canUseVideo = Boolean(media.videoUrl && !videoFailed);
  const showPosterOnly = Boolean(media.posterUrl && !canUseVideo && !posterFailed);
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const displayCreatorName = creatorName || 'Lumora Creator';
  const initial = displayCreatorName.trim().charAt(0).toUpperCase() || 'L';
  const visibleBadges = useMemo(() => badges.filter(Boolean).slice(0, 1), [badges]);
  const shouldHideControls = canUseVideo && playing && !controlsVisible;

  function clearHideTimer() {
    if (!hideTimerRef.current) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }

  function scheduleHideControls() {
    clearHideTimer();
    if (reducedMotion || !playing) return;
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      hideTimerRef.current = null;
    }, CONTROL_HIDE_DELAY_MS);
  }

  function revealControls() {
    setControlsVisible(true);
    scheduleHideControls();
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !canUseVideo || reducedMotion || !autoPlayMuted) return undefined;
    const container = shellRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.62) {
        video.muted = true;
        setMuted(true);
        void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      } else {
        video.pause();
        setPlaying(false);
      }
    }, { threshold: [0, 0.62, 1] });

    observer.observe(container);
    return () => observer.disconnect();
  }, [autoPlayMuted, canUseVideo, reducedMotion]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const handlePeerPlay = (event: Event) => {
      const peer = (event as CustomEvent<{ element?: HTMLVideoElement }>).detail?.element;
      if (!peer || peer === video) return;
      video.pause();
      setPlaying(false);
    };
    document.addEventListener('lumora-feed-video-play', handlePeerPlay);
    return () => document.removeEventListener('lumora-feed-video-play', handlePeerPlay);
  }, []);

  useEffect(() => {
    if (playing) {
      scheduleHideControls();
    } else {
      clearHideTimer();
      setControlsVisible(true);
    }
    return clearHideTimer;
  }, [playing, reducedMotion]);

  function togglePlay(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function toggleMuted(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const video = videoRef.current;
    const nextMuted = !muted;
    if (video) video.muted = nextMuted;
    setMuted(nextMuted);
  }

  return (
    <article
      ref={shellRef}
      className={`feed-video-card feed-video-card-${variant}${shouldHideControls ? ' feed-video-controls-hidden' : ''}`}
      onClick={onOpen}
      onMouseEnter={revealControls}
      onMouseMove={revealControls}
      onFocus={revealControls}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      aria-label={onOpen ? `Open ${title}` : title}
    >
      {!loaded && (canUseVideo || showPosterOnly) ? (
        <div className="cinematic-shimmer feed-video-loading" aria-hidden="true" />
      ) : null}

      {canUseVideo && media.videoUrl ? (
        <video
          ref={videoRef}
          src={media.videoUrl}
          poster={media.posterUrl && !posterFailed ? media.posterUrl : undefined}
          muted={muted}
          playsInline
          preload="metadata"
          loop
          controls={false}
          className="feed-video-media"
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0);
            setLoaded(true);
          }}
          onCanPlay={() => setLoaded(true)}
          onPlay={(event) => {
            setPlaying(true);
            document.dispatchEvent(new CustomEvent('lumora-feed-video-play', { detail: { element: event.currentTarget } }));
          }}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onError={() => {
            setVideoFailed(true);
            setLoaded(false);
          }}
        />
      ) : showPosterOnly && media.posterUrl ? (
        <img
          src={media.posterUrl}
          alt={title}
          loading="lazy"
          className="feed-video-media"
          onLoad={() => setLoaded(true)}
          onError={() => setPosterFailed(true)}
        />
      ) : (
        <div className="feed-video-placeholder">
          <strong>{title}</strong>
        </div>
      )}

      <div className="feed-video-vignette" aria-hidden="true" />

      {canUseVideo ? (
        <>
          <div className="feed-video-progress-rail" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="feed-video-control-row" aria-label="Video controls" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="feed-video-icon-button" onClick={togglePlay} aria-label={playing ? 'Pause video' : 'Play video'}>
              <span className={playing ? 'pause-glyph' : 'play-glyph'} aria-hidden="true" />
            </button>
            <span className="feed-video-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <button type="button" className="feed-video-icon-button" onClick={toggleMuted} aria-label={muted ? 'Unmute video' : 'Mute video'}>
              <span className={muted ? 'mute-glyph' : 'sound-glyph'} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : null}

      <div className="feed-video-copy">
        <div className="feed-video-author-row">
          <span className="feed-video-avatar" aria-hidden="true">
            {creatorAvatar ? <img src={creatorAvatar} alt="" /> : initial}
          </span>
          <span className="feed-video-author-copy">
            <strong>{displayCreatorName}</strong>
            {creatorUsername ? <span>@{creatorUsername}</span> : null}
          </span>
        </div>

        {caption ? <p>{caption}</p> : null}

        <div className="feed-video-meta-row">
          {visibleBadges.map((badge) => (
            <span key={badge} className="feed-video-meta-text">{badge}</span>
          ))}
          {statsText ? <span className="feed-video-meta-text">{statsText}</span> : null}
        </div>
      </div>
    </article>
  );
}
