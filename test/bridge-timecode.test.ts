import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { ShowinfoTracker, ffmpegArgs, parseShowinfo } from '../server/index.mjs';

// Lines as printed by ffmpeg 9.0 with `-loglevel level+info` and `showinfo=checksum=0`
// (captured locally from an MPEG-2 file written with `-timecode 10:00:00:00`).
const FRAME0 = '[Parsed_showinfo_0 @ 0x908805500] [info] n:   0 pts:      0 pts_time:0       duration:   3600 duration_time:0.04    fmt:yuv420p cl:left sar:1/1 s:320x180 i:P iskey:1 type:I ';
const GOP = '[Parsed_showinfo_0 @ 0x908805500] [info]   side data - GOP timecode: 10:00:00:00';
const FRAME1 = '[Parsed_showinfo_0 @ 0x908805500] [info] n:   1 pts:   3600 pts_time:0.04    duration:   3600 duration_time:0.04    fmt:yuv420p';

describe('time code from showinfo', () => {
  it('parses frame and side-data lines', () => {
    expect(parseShowinfo(FRAME0)).toEqual({ frame: 0, pts: 0 });
    expect(parseShowinfo(GOP)).toEqual({ timecode: '10:00:00:00', kind: 'gop' });
    // SEI time code (AV_FRAME_DATA_S12M_TIMECODE) – format assumed, not captured from a real stream
    expect(parseShowinfo('[Parsed_showinfo_0 @ 0x1] [info]   side data - SMPTE 12-1 timecode: timecode - 01:00:00;02')).toEqual({ timecode: '01:00:00;02', kind: 's12m' });
    expect(parseShowinfo('[info] Input #0, mpegts')).toBeNull();
  });
  it('tracker sends the time code with its pts and forwards errors', () => {
    const sent: Record<string, unknown>[] = [], errors: string[] = [];
    const tr = new ShowinfoTracker((m: Record<string, unknown>) => sent.push(m), (e: string) => errors.push(e), 0);
    tr.push(`${FRAME0}\n${GOP}\n${FRAME1}\n[error] Connection refused\n`);
    expect(sent.at(-1)).toMatchObject({ type: 'tc', tc: '10:00:00:00', tcPts: 0, pts: 0.04, first: 0, kind: 'gop' });
    expect(errors).toEqual(['Connection refused']);
  });
  it('ffmpeg arguments: info log without stats only when asked', () => {
    expect(ffmpegArgs({ url: 'rtsp://x/1', vf: 'scale' }).main.slice(0, 4)).toEqual(['-hide_banner', '-loglevel', 'error', '-nostdin']);
    expect(ffmpegArgs({ url: 'rtsp://x/1', vf: 'scale', log: 'level+info' }).main).toContain('-nostats');
  });
});
