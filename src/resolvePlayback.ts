// DaVinci Resolve while the timeline plays (#88).
//
// The scripting API answers no call during playback (measured with Resolve Studio 21.1.1,
// docs/research/resolve-playback.md), so the exact 16-bit stills stop. The bridge notices the
// silence (server/resolveWatch.mjs) and sends { type: 'resolve', state: 'playing' }. This module
// then captures the Resolve window, finds the viewer in it (src/resolveViewer.ts, matched
// against the last exact still) and shows the cropped live picture until the timeline pauses;
// the next still takes over again by itself (Source.showLive).
//
// Window capture works only on the computer that runs Resolve: in the desktop app without a
// prompt (Electron desktopCapturer), in the browser after the user chose the window once.

import type { ResolveRoute, Source } from './sources';
import { findViewer, toGray } from './resolveViewer';
import { t } from './i18n';

/** Label and explanation of a route, including how colour-accurate it is (source card). */
export function routeText(r: ResolveRoute): { label: string; detail: string } {
  if (r.route === 'still') return { label: t('source.resolve.route.still'), detail: t('source.resolve.route.stillWhy') };
  if (r.route === 'window') return { label: t('source.resolve.route.window'), detail: t('source.resolve.route.windowWhy') };
  return { label: t('source.resolve.route.none'), detail: t(`source.resolve.why.${r.why ?? 'starting'}`) };
}

export interface PlaybackDeps {
  /** desktop app: windows that can be captured (Electron desktopCapturer) */
  captureSources?: () => Promise<{ id: string; name: string }[]>;
  /** the bridge runs on this computer (window capture sees the same screen as Resolve) */
  localBridge: () => boolean;
  /** re-render the source list */
  changed: () => void;
}

interface Live {
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  canvas: HTMLCanvasElement;
  /** viewer in video pixels, by video size */
  crop: { key: string; rect: [number, number, number, number] } | null;
  playing: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  /** the browser stream was chosen by the user: kept until the source stops */
  picked: boolean;
  busy: boolean;
}

const lives = new WeakMap<Source, Live>();
/** desktop app: close the capture this long after playback stopped */
const KEEP_MS = 20000;

/** Is the bridge address on this computer? (Only then a window capture sees Resolve.) */
export function isLocalHost(url: string): boolean {
  let host = '';
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { return false; }
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

/** Window of the Resolve project among the capturable ones: its title, else any Resolve window. */
export function pickResolveWindow(list: { id: string; name: string }[], project?: string | null) {
  const wins = list.filter((c) => c.id.startsWith('window:'));
  return (project ? wins.find((c) => c.name === project) ?? wins.find((c) => c.name.includes(project)) : undefined)
    ?? wins.find((c) => /DaVinci Resolve/i.test(c.name)) ?? null;
}

/** Live picture route from the situation (pure, tested). */
export function routeFor(o: { playing: boolean; local: boolean; desktop: boolean; picked: boolean; found?: 'ok' | 'noWindow' | 'noViewer' | 'denied' | 'starting' }): ResolveRoute {
  if (!o.playing) return { route: 'still', playing: false };
  if (!o.local) return { route: 'none', why: 'remote', playing: true };
  if (!o.desktop && !o.picked) return { route: 'none', why: 'browser', playing: true };
  if (!o.found || o.found === 'ok') return { route: 'window', playing: true };
  return { route: 'none', why: o.found, playing: true };
}

/** Inset the found rectangle a little so no viewer border or UI pixel gets in. */
export function cropRect(r: { x: number; y: number; w: number; h: number }, vw: number, vh: number, inset = 0.006): [number, number, number, number] {
  const x0 = Math.round((r.x + r.w * inset) * vw), y0 = Math.round((r.y + r.h * inset) * vh);
  const x1 = Math.round((r.x + r.w * (1 - inset)) * vw), y1 = Math.round((r.y + r.h * (1 - inset)) * vh);
  return [Math.max(0, x0), Math.max(0, y0), Math.min(vw, x1), Math.min(vh, y1)];
}

export function attachResolvePlayback(deps: PlaybackDeps) {
  const live = (s: Source): Live => {
    let l = lives.get(s);
    if (!l) { l = { stream: null, video: null, canvas: document.createElement('canvas'), crop: null, playing: false, stopTimer: null, picked: false, busy: false }; lives.set(s, l); }
    return l;
  };
  const setRoute = (s: Source, r: ResolveRoute) => { s.resolveRoute = r; deps.changed(); };
  const close = (l: Live) => {
    l.stream?.getTracks().forEach((t) => t.stop());
    if (l.video) { l.video.pause(); l.video.srcObject = null; }
    l.stream = null; l.video = null; l.picked = false;
  };

  /** Grey still of the source's current exact frame (16-bit data), ~64 px wide. */
  const stillGray = (s: Source) => {
    const f = s.cpuFrame();
    if (!f) return null;
    return toGray(f.px, f.w, f.h, 64, 1, (i) => f.decode(f.px, i) as [number, number, number]);
  };

  /** Locate the viewer in the current video frame; keeps the last good crop for the same window size. */
  const locate = (s: Source, l: Live, still: ReturnType<typeof stillGray>) => {
    const v = l.video!;
    const key = `${v.videoWidth}x${v.videoHeight}`;
    if (still) {
      const c = document.createElement('canvas');
      const lv = [96, 320, 960].map((w) => {
        c.width = w; c.height = Math.max(1, Math.round((v.videoHeight * w) / v.videoWidth));
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        return toGray(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, w);
      });
      const r = findViewer(lv, still);
      if (r) { l.crop = { key, rect: cropRect(r, v.videoWidth, v.videoHeight) }; return true; }
    }
    return l.crop?.key === key;
  };

  const feed = (s: Source, l: Live) => {
    const v = l.video;
    if (!v) return;
    const step = () => {
      if (l.video !== v || !l.playing || !l.crop) return;
      const [x0, y0, x1, y1] = l.crop.rect, w = x1 - x0, h = y1 - y0;
      if (l.canvas.width !== w || l.canvas.height !== h) { l.canvas.width = w; l.canvas.height = h; }
      l.canvas.getContext('2d')!.drawImage(v, x0, y0, w, h, 0, 0, w, h);
      s.showLive(l.canvas);
      if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(step); else setTimeout(step, 33);
    };
    step();
  };

  const startVideo = async (l: Live, stream: MediaStream) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play();
    l.stream = stream; l.video = v;
  };

  const onPlaying = async (s: Source, project?: string | null) => {
    const l = live(s);
    l.playing = true;
    if (l.stopTimer) { clearTimeout(l.stopTimer); l.stopTimer = null; }
    const base = { playing: true, local: deps.localBridge(), desktop: !!deps.captureSources, picked: l.picked };
    if (!base.local || (!base.desktop && !l.stream)) return setRoute(s, routeFor(base));
    if (l.busy) return;
    l.busy = true;
    const still = stillGray(s); // before the first live frame replaces the still
    try {
      if (!l.stream && deps.captureSources) {
        setRoute(s, routeFor({ ...base, found: 'starting' }));
        const win = pickResolveWindow(await deps.captureSources(), project);
        if (!win) return setRoute(s, routeFor({ ...base, found: 'noWindow' }));
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: win.id, maxWidth: 3840, maxHeight: 2160, maxFrameRate: 30 } } } as unknown as MediaStreamConstraints);
        await startVideo(l, stream);
      }
      if (!l.playing) return;
      if (!locate(s, l, still)) return setRoute(s, routeFor({ ...base, found: 'noViewer' }));
      setRoute(s, routeFor({ ...base, found: 'ok' }));
      feed(s, l);
    } catch {
      close(l);
      setRoute(s, routeFor({ ...base, found: 'denied' }));
    } finally { l.busy = false; }
  };

  const onPaused = (s: Source) => {
    const l = live(s);
    l.playing = false;
    setRoute(s, routeFor({ playing: false, local: true, desktop: true, picked: false }));
    if (l.stream && !l.picked) l.stopTimer = setTimeout(() => { if (!l.playing) close(l); }, KEEP_MS);
  };

  return {
    onResolve(s: Source, msg: { state: 'playing' | 'paused'; project?: string | null }) {
      if (msg.state === 'playing') void onPlaying(s, msg.project);
      else onPaused(s);
    },
    onStop(s: Source) {
      const l = lives.get(s);
      if (!l) return;
      l.playing = false;
      if (l.stopTimer) clearTimeout(l.stopTimer);
      close(l);
      lives.delete(s);
    },
    /** Browser: the user chooses the Resolve window once (needs a click); kept while the source runs. */
    async pickWindow(s: Source) {
      const l = live(s);
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
        close(l);
        await startVideo(l, stream);
        l.picked = true;
        stream.getVideoTracks()[0]?.addEventListener('ended', () => { close(l); if (l.playing) setRoute(s, routeFor({ playing: true, local: deps.localBridge(), desktop: !!deps.captureSources, picked: false })); });
        if (l.playing) { l.playing = false; await onPlaying(s); } else deps.changed();
      } catch { /* cancelled */ }
    },
    hasPicked(s: Source) { return !!lives.get(s)?.picked; },
  };
}
