// Export of verification and uniformity results: CSV and a self-contained HTML page (print → PDF).

import { TARGET_LABELS } from './colorimetry';
import { UNIFORMITY_LIMITS, type UniformityReport } from './uniformity';
import type { VerifyReport } from './verify';
import type { Grade } from './colorimetry';
import { lang, num, t } from '../i18n';

// The report appears in the UI language; the CSV keeps a decimal point so spreadsheets read numbers.
const f = (v: number | undefined | null, d = 2) => (v == null || !Number.isFinite(v) ? '' : num(v, d));
const fc = (v: number | undefined | null, d = 2) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));
const locale = () => (lang() === 'de' ? 'de-DE' : 'en-GB');

/** Grade in the UI language ('good' / 'ok' / 'fail' are the internal codes). */
export const gradeLabel = (g: Grade): string => t(`calib.grade.${g}`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const csvCell = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function verifyCsv(r: VerifyReport): string {
  const head = [t('calib.csv.patch'), 'R', 'G', 'B', ...['X', 'Y', 'Z'].map((c) => t('calib.csv.target', { c })), ...['X', 'Y', 'Z'].map((c) => t('calib.csv.measured', { c })), 'dE00', 'dITP', 'dL', 'dC', 'dH'];
  const rows = r.rows.map((row) => [
    row.label, ...row.rgb.map((v) => String(Math.round(v * 255))), ...row.target.map((v) => fc(v, 4)),
    ...(row.measured ?? [NaN, NaN, NaN]).map((v) => fc(v, 4)), fc(row.dE00), fc(row.dITP), fc(row.dL), fc(row.dC), fc(row.dH),
  ]);
  return [head, ...rows].map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

export function uniformityCsv(u: UniformityReport): string {
  const head = [t('calib.csv.row'), t('calib.csv.col'), ...u.levels.flatMap((l) => [`dE00 ${l * 100}%`, t('calib.csv.lumDev', { l: l * 100 })]), 'CCT K', t('calib.csv.contrastT')];
  const rows = u.cells.map((c) => [String(c.row + 1), String(c.col + 1), ...c.dE00.flatMap((d, i) => [fc(d), fc(c.lumDev[i], 1)]), fc(c.cct, 0), fc(c.contrastT, 3)]);
  return [head, ...rows].map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

const GRADE_COLOR = { good: '#2e9d52', ok: '#c9a400', fail: '#d33' };
const badge = (g: keyof typeof GRADE_COLOR, text: string) => `<span class="b" style="background:${GRADE_COLOR[g]}">${esc(text)}</span>`;

/** Grey curve as inline SVG: measured vs target luminance over the signal (log luminance). */
function greySvg(r: VerifyReport) {
  if (r.grey.length < 2) return '';
  const W = 560, H = 260, pad = 36;
  const ys = r.grey.flatMap((p) => [p.measured, p.target]).filter((v) => v > 0);
  const lo = Math.log10(Math.min(...ys)), hi = Math.log10(Math.max(...ys));
  const X = (s: number) => pad + s * (W - 2 * pad), Y = (v: number) => H - pad - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const path = (k: 'measured' | 'target') => r.grey.map((p, i) => `${i ? 'L' : 'M'}${X(p.signal).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t('calib.html.greyCurve'))}">
<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="#bbb"/>
<path d="${path('target')}" fill="none" stroke="#888" stroke-dasharray="4 3"/>
<path d="${path('measured')}" fill="none" stroke="#1a73e8" stroke-width="2"/>
<text x="${pad}" y="${H - 8}" font-size="11">Signal 0 … 100 %</text>
<text x="${pad}" y="${pad - 8}" font-size="11">${esc(t('calib.html.axisLum', { lo: f(10 ** lo, 3), hi: f(10 ** hi, 1) }))}</text></svg>`;
}

const STYLE = `body{font:13px system-ui,sans-serif;color:#111;background:#fff;margin:24px;max-width:1000px}
table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:3px 6px;text-align:right}th{background:#f3f3f3}
td:first-child,th:first-child{text-align:left}.b{color:#fff;padding:1px 6px;border-radius:3px;font-size:12px}
.sw{display:inline-block;width:14px;height:14px;border:1px solid #999;vertical-align:middle}.note{color:#555}
@media print{button{display:none}}`;

export function verifyHtml(r: VerifyReport): string {
  const s = (st: VerifyReport['dE00']) => `<td>${f(st.mean)}</td><td>${f(st.median)}</td><td>${f(st.p95)}</td><td>${f(st.max)}</td>`;
  const rows = r.rows.map((row) => `<tr><td><span class="sw" style="background:rgb(${row.rgb.map((v) => Math.round(v * 255)).join(',')})"></span> ${esc(row.label)}</td>
<td>${f(row.target[1], 3)}</td><td>${row.measured ? f(row.measured[1], 3) : '–'}</td><td>${f(row.dE00)}</td><td>${f(row.dITP)}</td><td>${f(row.dL)}</td><td>${f(row.dC)}</td><td>${f(row.dH)}</td></tr>`).join('\n');
  return `<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><title>${esc(t('calib.verify.title', { set: r.set }))}</title><style>${STYLE}</style></head><body>
<h1>${esc(t('calib.html.verifyH1'))}</h1>
<p>${esc(new Date(r.date).toLocaleString(locale()))} · ${esc(t('calib.html.verifyMeta', { set: r.set, target: TARGET_LABELS[r.target.transfer], gamut: r.target.gamut, white: r.target.white.join(' / '), meter: r.meter || t('calib.manualShort') }))}</p>
<p><button onclick="print()">${esc(t('calib.html.print'))}</button></p>
<h2>${esc(t('calib.html.summary'))}</h2>
<table><tr><th>${esc(t('calib.html.metric'))}</th><th>${esc(t('calib.stat.mean'))}</th><th>Median</th><th>95 %</th><th>Max</th></tr>
<tr><td>${esc(t('calib.html.dePatches', { n: r.dE00.n }))}</td>${s(r.dE00)}</tr><tr><td>ΔITP</td>${s(r.dITP)}</tr></table>
<p>${esc(t('calib.html.deMean'))} ${badge(r.grades.mean, gradeLabel(r.grades.mean))} ${esc(t('calib.html.deMeanLimits'))} · Max ${badge(r.grades.max, gradeLabel(r.grades.max))} ${esc(t('calib.html.deMaxLimits'))}</p>
${!r.hdr && !r.whiteMeasured ? `<p class="note">⚠ ${esc(t('calib.html.noWhite'))}</p>` : ''}
${r.hdr ? '' : `<p>${esc(t('calib.html.levels', { lw: f(r.lw, 1), lb: f(r.lb, 4), c: Number.isFinite(r.contrast) ? `${Math.round(r.contrast)}:1` : '∞' }))}</p>`}
${r.white ? `<p>${esc(t('calib.html.whitePoint', { x: f(r.white.xy[0], 4), y: f(r.white.xy[1], 4), cct: Math.round(r.white.cct), duv: f(r.white.duv, 4), de: f(r.white.dE00) }))} ${badge(r.white.grade, gradeLabel(r.white.grade))} (≤ 2 / ≤ 1)</p>` : ''}
<h2>${esc(t('calib.html.greyCurve'))}</h2>${greySvg(r)}
${r.grey.some((p) => p.gamma) ? `<table><tr><th>Signal</th><th>${esc(t('calib.html.targetLum'))}</th><th>${esc(t('calib.html.measuredLum'))}</th><th>${esc(t('calib.html.effGamma'))}</th></tr>${r.grey.map((p) => `<tr><td>${f(p.signal * 100, 1)} %</td><td>${f(p.target, 3)}</td><td>${f(p.measured, 3)}</td><td>${f(p.gamma)}</td></tr>`).join('')}</table>` : ''}
<h2>${esc(t('calib.html.patches'))}</h2>
<table><tr><th>${esc(t('calib.csv.patch'))}</th><th>${esc(t('calib.csv.target', { c: 'Y' }))}</th><th>${esc(t('calib.csv.measured', { c: 'Y' }))}</th><th>ΔE00</th><th>ΔITP</th><th>ΔL</th><th>ΔC</th><th>ΔH</th></tr>
${rows}</table>
<p class="note">${esc(t('calib.html.verifyNote'))}</p>
</body></html>`;
}

export function uniformityHtml(u: UniformityReport): string {
  const cell = (c: UniformityReport['cells'][number]) => `<td style="background:${GRADE_COLOR[c.grade]}22">
<b>${f(Math.max(...c.dE00))}</b><br><span class="note">${c.lumDev.map((d) => `${d >= 0 ? '+' : ''}${f(d, 1)} %`).join(' · ')}</span><br>${c.cct ? `${Math.round(c.cct)} K` : ''}${c.contrastT != null ? ` · T ${f(c.contrastT, 3)}` : ''}</td>`;
  const grid = Array.from({ length: u.n }, (_, r) => `<tr>${u.cells.filter((c) => c.row === r).map(cell).join('')}</tr>`).join('\n');
  return `<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><title>${esc(t('calib.uniformity.title', { n: u.n }))}</title><style>${STYLE} td{text-align:center;min-width:90px}</style></head><body>
<h1>${esc(t('calib.uniformity.title', { n: u.n }))}</h1><p>${esc(new Date(u.date).toLocaleString(locale()))} · ${esc(t('calib.html.uniMeta', { levels: u.levels.map((l) => `${l * 100} %`).join(', ') }))}</p>
<p><button onclick="print()">${esc(t('calib.html.print'))}</button></p>
<p>Max ΔE00 ${f(u.maxDE00)} ${badge(u.grade, gradeLabel(u.grade))} ${esc(t('calib.html.uniLimits', { shall: UNIFORMITY_LIMITS.dE00.nominal, should: UNIFORMITY_LIMITS.dE00.recommended }))} · ${esc(t('calib.html.contrastDev', { t: f(u.maxT, 3) }))} ${badge(u.contrastOk ? 'good' : 'fail', `${u.contrastOk ? '<' : '≥'} ${num(UNIFORMITY_LIMITS.contrastT)}`)}</p>
${u.warnings.map((w) => `<p class="note">⚠ ${esc(w)}</p>`).join('')}
<table>${grid}</table>
<p class="note">${esc(t('calib.html.uniNote'))}</p>
</body></html>`;
}
