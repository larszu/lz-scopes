import { describe, expect, it } from 'vitest';
import { metricsAccess, metricsText } from '../server/metrics.mjs';

const base = { version: '1.2.3', uptimeS: 10, appConnected: true, events: 4, streams: [], ptp: null, rtp: null };

/** Every sample line of the text exposition format: name{labels} value */
const SAMPLE = /^[a-zA-Z_:][a-zA-Z0-9_:]*(\{([a-zA-Z_][a-zA-Z0-9_]*="([^"\\\n]|\\.)*",?)*\})? -?[0-9.e+-]+$/;

describe('/metrics (#239)', () => {
  it('is valid text exposition format with HELP and TYPE for every metric', () => {
    const text = metricsText({
      ...base,
      streams: [{ id: 3, source: 'srt://host.example:9000 "x"\\', sent: 100, dropped: 1, bytes: 4096, width: 1920, height: 1080, fps: 50 }],
      ptp: { state: 'receiving', offsetNs: 1500, jitterNs: 200, meanPathDelayNs: null, domain: 127, gm: { identity: 'aa:bb', clockClass: 6 }, sm: { gmLockingStatus: 4 } },
      rtp: { group: '239.0.0.1', port: 5004, packets: 9000, frames: 50, lagMs: 1.5, gridTicks: 0 },
    });
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.trim().split('\n');
    const names = new Set<string>();
    for (const l of lines) {
      if (l.startsWith('# TYPE ')) { names.add(l.split(' ')[2]); expect(l).toMatch(/ (gauge|counter)$/); continue; }
      if (l.startsWith('# HELP ')) continue;
      expect(l).toMatch(SAMPLE);
      expect(names.has(l.split(/[{ ]/)[0])).toBe(true);
    }
    expect(text).toContain('lzscopes_bridge_info{version="1.2.3"} 1');
    expect(text).toContain('lzscopes_stream_frames_sent_total{stream="3",source="srt://host.example:9000 \\"x\\"\\\\"} 100');
    expect(text).toContain('lzscopes_ptp_state{state="receiving"} 1');
    expect(text).toContain('lzscopes_ptp_state{state="off"} 0');
    expect(text).toContain('lzscopes_ptp_offset_seconds 0.0000015');
    expect(text).not.toContain('lzscopes_ptp_mean_path_delay_seconds');
    expect(text).toContain('lzscopes_ptp_gm_locking_status 4');
    expect(text).toContain('lzscopes_rtp_lag_seconds{group="239.0.0.1",port="5004"} 0.0015');
    expect(text).toContain('lzscopes_events_total 4');
    // counters end in _total
    for (const l of lines.filter((x) => x.endsWith(' counter'))) expect(l.split(' ')[2]).toMatch(/_total$/);
  });

  it('without PTP monitor: state off and no PTP values', () => {
    const text = metricsText(base);
    expect(text).toContain('lzscopes_ptp_state{state="off"} 1');
    expect(text).not.toContain('lzscopes_ptp_offset_seconds');
    expect(text).toContain('lzscopes_streams 0');
  });

  it('is local by default; others need the token; foreign web pages never', () => {
    expect(metricsAccess({ remote: '127.0.0.1' })).toBe(null);
    expect(metricsAccess({ remote: '::ffff:127.0.0.1', token: 'x' })).toBe(null);
    expect(metricsAccess({ remote: '198.51.100.7' })?.status).toBe(403);
    expect(metricsAccess({ remote: '198.51.100.7', token: 'x', presented: 'y' })?.status).toBe(401);
    expect(metricsAccess({ remote: '198.51.100.7', token: 'x', presented: 'x' })).toBe(null);
    expect(metricsAccess({ remote: '127.0.0.1', origin: 'http://evil.example', host: '127.0.0.1:4192' })?.status).toBe(403);
    expect(metricsAccess({ remote: '127.0.0.1', origin: 'http://127.0.0.1:4192', host: '127.0.0.1:4192' })).toBe(null);
  });
});
