// Prometheus endpoint of the bridge (#239): GET /metrics in the text exposition format 0.0.4
// (https://prometheus.io/docs/instrumenting/exposition_formats/ – HELP/TYPE lines, label values
// with \\, \" and \n escaped; base units seconds and bytes, counters end in _total, per
// https://prometheus.io/docs/practices/naming/). Only what the bridge itself knows: streams,
// PTP monitor, ST 2110 RTP check, event log. Local by default (see `metricsAccess`).

import { isLoopback } from './control.mjs';

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** PTP states of server/ptp.mjs PtpMonitor.status(), plus 'off' (monitor not running). */
export const PTP_STATES = ['off', 'none', 'error', 'stale', 'sync-only', 'announce', 'receiving'];

const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

/**
 * Text of /metrics.
 * @param {{ version?: string, uptimeS: number, appConnected: boolean, events: number,
 *   streams: { id: number, source: string, sent: number, dropped: number, bytes: number, width?: number, height?: number, fps?: number }[],
 *   ptp: any, rtp: any }} s
 */
export function metricsText(s) {
  const out = [];
  const metric = (name, type, help, rows) => {
    const lines = rows.map(([labels, v]) => {
      const val = num(v);
      if (val === null) return null;
      const l = Object.entries(labels ?? {}).map(([k, x]) => `${k}="${esc(x)}"`).join(',');
      return `${name}${l ? `{${l}}` : ''} ${val}`;
    }).filter(Boolean);
    if (!lines.length) return;
    out.push(`# HELP ${name} ${help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}`, `# TYPE ${name} ${type}`, ...lines);
  };
  metric('lzscopes_bridge_info', 'gauge', 'LZ Scopes bridge, value always 1', [[{ version: s.version ?? '' }, 1]]);
  metric('lzscopes_uptime_seconds', 'gauge', 'Seconds since the bridge started', [[null, s.uptimeS]]);
  metric('lzscopes_app_connected', 'gauge', '1 while an LZ Scopes main window is connected to /control', [[null, s.appConnected ? 1 : 0]]);
  metric('lzscopes_streams', 'gauge', 'Open stream sockets', [[null, s.streams.length]]);
  const lab = (x) => ({ stream: String(x.id), source: x.source });
  metric('lzscopes_stream_frames_sent_total', 'counter', 'Frames sent to the client on this stream socket', s.streams.map((x) => [lab(x), x.sent]));
  metric('lzscopes_stream_frames_dropped_total', 'counter', 'Frames the bridge dropped because the client was too slow', s.streams.map((x) => [lab(x), x.dropped]));
  metric('lzscopes_stream_bytes_sent_total', 'counter', 'Binary bytes sent on this stream socket (pictures and sound)', s.streams.map((x) => [lab(x), x.bytes]));
  metric('lzscopes_stream_width_pixels', 'gauge', 'Picture width of the source', s.streams.map((x) => [lab(x), x.width]));
  metric('lzscopes_stream_height_pixels', 'gauge', 'Picture height of the source', s.streams.map((x) => [lab(x), x.height]));
  metric('lzscopes_stream_fps', 'gauge', 'Frame rate of the source as reported by the decoder', s.streams.map((x) => [lab(x), x.fps]));

  const p = s.ptp;
  const state = p ? p.state : 'off';
  metric('lzscopes_ptp_state', 'gauge', 'PTP monitor state, 1 for the current one', PTP_STATES.map((x) => [{ state: x }, x === state ? 1 : 0]));
  if (p) {
    // offsetNs: local clock − grandmaster, median of 10 s (server/ptp.mjs); software time stamps
    metric('lzscopes_ptp_offset_seconds', 'gauge', 'Local clock minus PTP grandmaster (median of 10 s, software time stamps)', [[null, p.offsetNs === null ? null : p.offsetNs / 1e9]]);
    metric('lzscopes_ptp_jitter_seconds', 'gauge', 'Standard deviation of the PTP offset over 10 s', [[null, p.jitterNs === null ? null : p.jitterNs / 1e9]]);
    metric('lzscopes_ptp_mean_path_delay_seconds', 'gauge', 'PTP mean path delay (only with delay requests)', [[null, p.meanPathDelayNs === null ? null : p.meanPathDelayNs / 1e9]]);
    if (p.gm) metric('lzscopes_ptp_clock_class', 'gauge', 'clockClass of the grandmaster (IEEE 1588-2019 7.6.2.5)', [[{ grandmaster: p.gm.identity }, p.gm.clockClass]]);
    if (p.domain !== undefined) metric('lzscopes_ptp_domain', 'gauge', 'PTP domain shown', [[null, p.domain]]);
    // SMPTE ST 2059-2 SM TLV gmLockingStatus: 0 not in use, 1 free run, 2 cold locking, 3 warm locking, 4 locked
    if (p.sm) metric('lzscopes_ptp_gm_locking_status', 'gauge', 'gmLockingStatus of the SMPTE ST 2059-2 SM TLV (4 = locked)', [[null, p.sm.gmLockingStatus]]);
  }
  const r = s.rtp;
  if (r) {
    const l = { group: r.group, port: String(r.port) };
    metric('lzscopes_rtp_packets_total', 'counter', 'RTP packets received on the watched ST 2110 stream', [[l, r.packets]]);
    metric('lzscopes_rtp_frames', 'gauge', 'Frames seen on the watched ST 2110 stream in the last 2 s', [[l, r.frames]]);
    metric('lzscopes_rtp_lag_seconds', 'gauge', 'Arrival time minus RTP time (ST 2110-10), median of 2 s', [[l, r.lagMs === null ? null : r.lagMs / 1000]]);
    metric('lzscopes_rtp_grid_ticks', 'gauge', 'RTP timestamp minus the frame grid (ST 2110-10 7.6), 90 kHz ticks', [[l, r.gridTicks]]);
  }
  metric('lzscopes_events_total', 'counter', 'Entries written to the event log since start', [[null, s.events]]);
  return out.join('\n') + '\n';
}

/**
 * Who may read /metrics and /api/events: this computer always (no foreign web page – a browser
 * page from another origin carries its Origin header), others only with the control token
 * (Authorization: Bearer <token>, as the Prometheus `authorization` setting sends it).
 */
export function metricsAccess({ remote, token, presented, origin, host }) {
  if (origin && host) {
    let o = '';
    try { o = new URL(origin).host; } catch { /* malformed */ }
    if (o !== host) return { status: 403, error: 'Foreign web origin' };
  }
  if (isLoopback(remote)) return null;
  if (token) return presented === token ? null : { status: 401, error: 'Token missing or wrong' };
  return { status: 403, error: 'Only from 127.0.0.1 (or with the control token, see docs/control-api.md)' };
}
