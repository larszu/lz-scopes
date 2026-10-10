// Recording of browser sources (camera, screen capture, video file, test pattern) with
// MediaRecorder (8 bit, WebM or MP4, whatever the browser offers). The chunks go to the bridge
// (/record-upload, server/recorder.mjs), which writes them into the released recording folder;
// a new file starts every `segmentMs`, so a crash costs at most one segment.

export interface UploadTarget { bridge: string; root: string; take: string; name: string }

/** First container/codec this browser records; '' = MediaRecorder missing. */
export function pickMime(isSupported: (m: string) => boolean = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)): string {
  for (const m of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4']) if (isSupported(m)) return m;
  return '';
}
export const extOf = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

export class BrowserRecorder {
  private rec: MediaRecorder | null = null;
  private ws: WebSocket | null = null;
  private part = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  bytes = 0;
  readonly mime: string;
  /** Date.now() of the first chunk of each part */
  readonly parts: { file: string; utcMs: number }[] = [];
  onError: (msg: string) => void = () => {};

  constructor(private stream: MediaStream, private target: UploadTarget, private segmentMs: number) {
    this.mime = pickMime();
  }

  start() {
    if (!this.mime) throw new Error('MediaRecorder');
    this.next();
    this.timer = setInterval(() => this.rotate(), this.segmentMs);
  }

  private url() {
    const q = new URLSearchParams({ root: this.target.root, take: this.target.take, name: this.target.name, ext: extOf(this.mime), part: String(this.part) });
    return `${this.target.bridge}/record-upload?${q}`;
  }

  /** New file: own socket, own MediaRecorder (each file starts with its own header). */
  private next() {
    const ws = new WebSocket(this.url());
    ws.binaryType = 'arraybuffer';
    // chunks must reach the file in order: one chain per file, waiting for the socket first
    const open = new Promise<void>((ok) => { ws.onopen = () => ok(); });
    let chain = open;
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data));
        if (m.type === 'error') this.onError(m.message ?? 'error');
        if (m.type === 'record' && m.file && !this.parts.some((p) => p.file === m.file)) this.parts.push({ file: m.file, utcMs: Date.now() });
      } catch { /* ignore */ }
    };
    const rec = new MediaRecorder(this.stream, { mimeType: this.mime });
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.bytes += e.data.size;
      const blob = e.data;
      chain = chain.then(async () => { const buf = await blob.arrayBuffer(); if (ws.readyState === WebSocket.OPEN) ws.send(buf); });
    };
    rec.onstop = () => { chain = chain.then(() => new Promise((ok) => setTimeout(ok, 300))).then(() => ws.close()); };
    rec.start(1000);
    this.rec = rec; this.ws = ws;
  }

  private rotate() {
    if (this.stopped) return;
    this.rec?.stop();
    this.part++;
    this.next();
  }

  /** Companion file (JSON) through the current socket. */
  sidecar(data: object) {
    const ws = this.ws;
    const text = JSON.stringify({ type: 'sidecar', data });
    if (ws?.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws.send(text), { once: true });
    else if (ws?.readyState === WebSocket.OPEN) ws.send(text);
  }

  stop(final?: object) {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (final) this.sidecar(final);
    this.rec?.stop();
  }
}
