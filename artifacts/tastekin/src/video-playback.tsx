import { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Pause, Play, Video as VideoIcon, Volume2, VolumeX } from 'lucide-react';

// Video Foundation, Phase 3B — rendering a already-resolved playback URL
// (server-issued, see artifacts/api-server/src/lib/video-playback.ts) as an
// actual <video>. Nothing here ever constructs a Bunny URL itself: every
// component below only ever plays `video.playbackUrl`/`video.posterUrl`
// exactly as the server returned them, and treats their absence (or a
// runtime playback error) as a normal, safe "show a placeholder" outcome —
// never a crash.

export type PlaybackVideo = {
  playbackUrl?: string | null;
  posterUrl?: string | null;
  durationSeconds?: number | null;
  width?: number | null;
  height?: number | null;
};

export function hasResolvedPlayback(video: PlaybackVideo | undefined): video is PlaybackVideo & { playbackUrl: string } {
  return Boolean(video?.playbackUrl);
}

/** mm:ss for a caption/badge; never throws on a missing/odd value. */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remaining = total % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

/**
 * Attaches `src` to `videoEl` for HLS playback: native `<video>` support
 * (Safari, iOS) is used directly, hls.js (MediaSource-based) is used
 * everywhere else it's supported, and neither is available the element is
 * simply left without a source — the caller's own `onerror`/timeout
 * handling is what surfaces the safe placeholder in that case. Returns a
 * cleanup function that must be called on unmount/src change to avoid
 * leaking an hls.js instance.
 */
function attachHlsSource(videoEl: HTMLVideoElement, src: string, onFatalError: () => void): () => void {
  if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = src;
    return () => { videoEl.removeAttribute('src'); videoEl.load(); };
  }
  if (Hls.isSupported()) {
    const hls = new Hls();
    hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) onFatalError(); });
    hls.loadSource(src);
    hls.attachMedia(videoEl);
    return () => hls.destroy();
  }
  // Neither native HLS nor hls.js is available in this browser — there is
  // no safe fallback source to hand the <video> element, so leave it
  // sourceless and let the caller's placeholder handling take over.
  onFatalError();
  return () => undefined;
}

/**
 * Module-level (not per-component) so "only one Home video may play at a
 * time" holds across every card currently mounted in the feed, not just
 * within one card's own subtree. A card that starts playing calls
 * `claim(id, pause)`; whichever card previously held the claim is told to
 * pause. There is exactly one DOM (one tab) this app ever runs in, so a
 * plain module-level singleton is sufficient — no React context needed.
 */
const exclusivePlayback = (() => {
  let activeId: string | null = null;
  let activePause: (() => void) | null = null;
  return {
    claim(id: string, pause: () => void) {
      if (activeId && activeId !== id) activePause?.();
      activeId = id;
      activePause = pause;
    },
    release(id: string) {
      if (activeId === id) { activeId = null; activePause = null; }
    },
  };
})();

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Centered VideoIcon over a muted panel — the one safe placeholder used everywhere a poster/playback URL is missing or fails to load, matching the composer's own existing `.video-uploader-placeholder` treatment. */
function VideoPlaceholder({ className = '' }: { className?: string }) {
  return <div className={`video-card-placeholder ${className}`}><VideoIcon size={26} /></div>;
}

/**
 * The Home feed's autoplaying card. Fixed 4:5 media box; autoplays muted +
 * playsInline only once "sufficiently visible" (IntersectionObserver,
 * ≥60% of the card's own box), pauses when it scrolls out of that
 * threshold, when the page is hidden, or when a different Home card starts
 * — never more than one playing at once. Respects prefers-reduced-motion
 * by never auto-starting; the visible play button still works on tap.
 */
export function HomeVideoCard({ id, video, ar, onOpen }: { id: string; video: PlaybackVideo; ar: boolean; onOpen: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const t = (en: string, arValue: string) => (ar ? arValue : en);

  const pause = () => { videoRef.current?.pause(); };

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !hasResolvedPlayback(video) || failed) return;
    const cleanup = attachHlsSource(videoEl, video.playbackUrl, () => setFailed(true));
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.playbackUrl, failed]);

  useEffect(() => {
    const container = containerRef.current;
    const videoEl = videoRef.current;
    if (!container || !videoEl || !hasResolvedPlayback(video) || failed) return undefined;
    const attemptPlay = () => {
      if (prefersReducedMotion()) return;
      exclusivePlayback.claim(id, pause);
      void videoEl.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) attemptPlay();
        else { videoEl.pause(); exclusivePlayback.release(id); }
      }
    }, { threshold: [0, 0.6] });
    observer.observe(container);
    const onVisibilityChange = () => { if (document.hidden) { videoEl.pause(); exclusivePlayback.release(id); } };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      exclusivePlayback.release(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, video.playbackUrl, failed]);

  const togglePlay = (event: React.MouseEvent) => {
    event.stopPropagation();
    const videoEl = videoRef.current;
    if (!videoEl) return;
    // Branches on the `playing` state (not `videoEl.paused`) so this stays
    // correct under a test-mocked play()/pause() that doesn't update the
    // native `.paused` getter, and to avoid a stale-DOM-vs-state race.
    if (!playing) { exclusivePlayback.claim(id, pause); void videoEl.play().then(() => setPlaying(true)).catch(() => undefined); }
    else { videoEl.pause(); setPlaying(false); exclusivePlayback.release(id); }
  };
  const toggleMute = (event: React.MouseEvent) => {
    event.stopPropagation();
    const videoEl = videoRef.current;
    if (!videoEl) return;
    videoEl.muted = !videoEl.muted;
    setMuted(videoEl.muted);
  };

  if (!hasResolvedPlayback(video) || failed) {
    return <div className="video-card-media" ref={containerRef} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(); }} aria-label={t('Open Edit', 'فتح التعديل')}>{video.posterUrl ? <img src={video.posterUrl} alt="" onError={() => setFailed(true)} /> : <VideoPlaceholder />}</div>;
  }

  return (
    <div className="video-card-media" ref={containerRef} data-testid={`home-video-${id}`} data-playing={playing ? 'true' : 'false'} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(); }} aria-label={t('Open Edit', 'فتح التعديل')}>
      <video
        ref={videoRef}
        poster={video.posterUrl ?? undefined}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
        aria-label={t('Video Edit', 'تعديل فيديو')}
      />
      {video.durationSeconds ? <span className="video-duration-badge">{formatDuration(video.durationSeconds)}</span> : null}
      <div className="video-card-controls">
        <button type="button" className="video-control-button" onClick={togglePlay} aria-label={playing ? t('Pause', 'إيقاف مؤقت') : t('Play', 'تشغيل')}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="video-control-button" onClick={toggleMute} aria-label={muted ? t('Unmute', 'إلغاء كتم الصوت') : t('Mute', 'كتم الصوت')}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
    </div>
  );
}

/**
 * The Profile/Saved/Explore poster-only presentation: a static 4:5 poster
 * with a centered play glyph and a duration badge, never autoplaying —
 * tapping it (like tapping the rest of the card) opens Edit Detail via the
 * caller's own onOpen, exactly like a photo card.
 */
export function PosterVideoCard({ video, ar }: { video: PlaybackVideo; ar: boolean }) {
  const [failed, setFailed] = useState(false);
  const t = (en: string, arValue: string) => (ar ? arValue : en);
  return (
    <div className="video-card-media video-card-poster-only">
      {video.posterUrl && !failed ? <img src={video.posterUrl} alt="" onError={() => setFailed(true)} /> : <VideoPlaceholder />}
      <span className="video-poster-play" aria-hidden="true"><Play size={20} fill="currentColor" /></span>
      {video.durationSeconds ? <span className="video-duration-badge">{formatDuration(video.durationSeconds)}</span> : null}
      <span className="sr-only">{t('Video', 'فيديو')}</span>
    </div>
  );
}

/**
 * Edit Detail's large vertical player: respects the video's own real
 * aspect ratio (from the server-resolved width/height) rather than forcing
 * 4:5, falls back to the composer's own 9:16 recommendation when no
 * dimensions are known yet, and uses the browser's native `controls` UI
 * (play/pause/seek/volume) rather than the Home card's minimal custom set.
 * Never autoplays.
 */
export function VideoDetailPlayer({ video, ar }: { video: PlaybackVideo; ar: boolean }) {
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const aspect = useMemo(() => (video.width && video.height ? `${video.width} / ${video.height}` : '9 / 16'), [video.width, video.height]);
  const t = (en: string, arValue: string) => (ar ? arValue : en);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !hasResolvedPlayback(video) || failed) return;
    const cleanup = attachHlsSource(videoEl, video.playbackUrl, () => setFailed(true));
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.playbackUrl, failed]);

  if (!hasResolvedPlayback(video) || failed) {
    return <div className="video-detail-player" style={{ aspectRatio: aspect }}>{video.posterUrl ? <img src={video.posterUrl} alt="" /> : <VideoPlaceholder />}</div>;
  }

  return (
    <div className="video-detail-player" style={{ aspectRatio: aspect }}>
      <video ref={videoRef} controls playsInline poster={video.posterUrl ?? undefined} onError={() => setFailed(true)} aria-label={t('Video Edit', 'تعديل فيديو')} />
    </div>
  );
}
