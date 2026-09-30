// Export of verification and uniformity results: CSV and a self-contained HTML page (print → PDF).

import { TARGET_LABELS } from './colorimetry';
import { UNIFORMITY_LIMITS, type UniformityReport } from './uniformity';
import type { VerifyReport } from './verify';

const f = (v: number | undefined | null, d = 2) => (v == null || !Number.isFinite(v) ? '' : v.toFixed(d));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const csvCell = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function verifyCsv(r: VerifyReport): string {
  const head = ['Feld', 'R', 'G', 'B', 'Soll X', 'Soll Y', 'Soll Z', 'Ist X', 'Ist Y', 'Ist Z', 'dE00', 'dITP', 'dL', 'dC', 'dH'];
  const rows = r.rows.map((row) => [
    row.label, ...row.rgb.map((v) => String(Math.round(v * 255))), ...row.target.map((v) => f(v, 4)),
    ...(row.measured ?? [NaN, NaN, NaN]).map((v) => f(v, 4)), f(row.dE00), f(row.dITP), f(row.dL), f(row.dC), f(row.dH),
  ]);
  return [head, ...rows].map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

export function uniformityCsv(u: UniformityReport): string {
  const head = ['Zeile', 'Spalte', ...u.levels.flatMap((l) => [`dE00 ${l * 100}%`, `Leuchtdichte ${l * 100}% Abw. %`]), 'CCT K', 'Kontrastabw. T'];
  const rows = u.cells.map((c) => [String(c.row + 1), String(c.col + 1), ...c.dE00.flatMap((d, i) => [f(d), f(c.lumDev[i], 1)]), f(c.cct, 0), f(c.contrastT, 3)]);
  return [head, ...rows].map((l) => l.map(csvCell).join(',')).join('\n') + '\n';
}

const GRADE_COLOR = { gut: '#2e9d52', ok: '#c9a400', aus: '#d33' };
const badge = (g: keyof typeof GRADE_COLOR, text: string) => `<span class="b" style="background:${GRADE_COLOR[g]}">${esc(text)}</span>`;

/** Grey curve as inline SVG: measured vs target luminance over the signal (log luminance). */
function greySvg(r: VerifyReport) {
  if (r.grey.length < 2) return '';
  const W = 560, H = 260, pad = 36;
  const ys = r.grey.flatMap((p) => [p.measured, p.target]).filter((v) => v > 0);
  const lo = Math.log10(Math.min(...ys)), hi = Math.log10(Math.max(...ys));
  const X = (s: number) => pad + s * (W - 2 * pad), Y = (v: number) => H - pad - ((Math.log10(Math.max(v, 10 ** lo)) - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const path = (k: 'measured' | 'target') => r.grey.map((p, i) => `${i ? 'L' : 'M'}${X(p.signal).toFixed(1)},${Y(p[k]).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Graukurve">
<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="#bbb"/>
<path d="${path('target')}" fill="none" stroke="#888" stroke-dasharray="4 3"/>
<path d="${path('measured')}" fill="none" stroke="#1a73e8" stroke-width="2"/>
<text x="${pad}" y="${H - 8}" font-size="11">Signal 0 … 100 %</text>
<text x="${pad}" y="${pad - 8}" font-size="11">cd/m² (log): gemessen blau, Soll gestrichelt · ${f(10 ** lo, 3)} … ${f(10 ** hi, 1)}</text></svg>`;
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
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Verifikation ${esc(r.set)}</title><style>${STYLE}</style></head><body>
<h1>Display-Verifikation</h1>
<p>${esc(new Date(r.date).toLocaleString('de-DE'))} · Messsatz ${esc(r.set)} · Ziel ${esc(TARGET_LABELS[r.target.transfer])}, Gamut ${esc(r.target.gamut)}, Weiß xy ${r.target.white.join(' / ')} · Messung: ${esc(r.meter || 'manuell')}</p>
<p><button onclick="print()">Drucken / als PDF sichern</button></p>
<h2>Zusammenfassung</h2>
<table><tr><th>Kennzahl</th><th>Mittel</th><th>Median</th><th>95 %</th><th>Max</th></tr>
<tr><td>ΔE00 (${r.dE00.n} Felder)</td>${s(r.dE00)}</tr><tr><td>ΔITP</td>${s(r.dITP)}</tr></table>
<p>ΔE00 Mittel ${badge(r.grades.mean, r.grades.mean)} (≤ 1,5 nominal, ≤ 1 empfohlen) · Max ${badge(r.grades.max, r.grades.max)} (≤ 4 / ≤ 3). Grenzwerte wie DisplayCAL „Default“; ΔITP ohne Grenzwert.</p>
${!r.hdr && !r.whiteMeasured ? '<p class="note">⚠ Weiß/Schwarz nicht gemessen – Sollwerte mit 100 bzw. 0 cd/m².</p>' : ''}
${r.hdr ? '' : `<p>Weiß ${f(r.lw, 1)} cd/m² · Schwarz ${f(r.lb, 4)} cd/m² · Kontrast ${Number.isFinite(r.contrast) ? `${Math.round(r.contrast)}:1` : '∞'}</p>`}
${r.white ? `<p>Weißpunkt xy ${f(r.white.xy[0], 4)} / ${f(r.white.xy[1], 4)} · CCT ${Math.round(r.white.cct)} K · Duv ${f(r.white.duv, 4)} · ΔE00 zum Soll ${f(r.white.dE00)} ${badge(r.white.grade, r.white.grade)} (≤ 2 / ≤ 1)</p>` : ''}
<h2>Graukurve</h2>${greySvg(r)}
${r.grey.some((p) => p.gamma) ? `<table><tr><th>Signal</th><th>Soll cd/m²</th><th>Ist cd/m²</th><th>eff. Gamma</th></tr>${r.grey.map((p) => `<tr><td>${f(p.signal * 100, 1)} %</td><td>${f(p.target, 3)}</td><td>${f(p.measured, 3)}</td><td>${f(p.gamma)}</td></tr>`).join('')}</table>` : ''}
<h2>Felder</h2>
<table><tr><th>Feld</th><th>Soll Y</th><th>Ist Y</th><th>ΔE00</th><th>ΔITP</th><th>ΔL</th><th>ΔC</th><th>ΔH</th></tr>
${rows}</table>
<p class="note">ΔE00 in CIELAB relativ zum Soll-Weiß, ΔITP nach BT.2124 auf absoluten Werten. Sollwerte aus den 8-bit-Codewerten der Ausgabe. Erzeugt mit LZ Scopes.</p>
</body></html>`;
}

export function uniformityHtml(u: UniformityReport): string {
  const cell = (c: UniformityReport['cells'][number]) => `<td style="background:${GRADE_COLOR[c.grade]}22">
<b>${f(Math.max(...c.dE00))}</b><br><span class="note">${c.lumDev.map((d) => `${d >= 0 ? '+' : ''}${f(d, 1)} %`).join(' · ')}</span><br>${c.cct ? `${Math.round(c.cct)} K` : ''}${c.contrastT != null ? ` · T ${f(c.contrastT, 3)}` : ''}</td>`;
  const grid = Array.from({ length: u.n }, (_, r) => `<tr>${u.cells.filter((c) => c.row === r).map(cell).join('')}</tr>`).join('\n');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Uniformität ${u.n}×${u.n}</title><style>${STYLE} td{text-align:center;min-width:90px}</style></head><body>
<h1>Uniformität ${u.n}×${u.n}</h1><p>${esc(new Date(u.date).toLocaleString('de-DE'))} · Stufen ${u.levels.map((l) => `${l * 100} %`).join(', ')} · Referenz Mittelfeld</p>
<p><button onclick="print()">Drucken / als PDF sichern</button></p>
<p>Max ΔE00 ${f(u.maxDE00)} ${badge(u.grade, u.grade)} (≤ ${UNIFORMITY_LIMITS.dE00.nominal} muss, ≤ ${UNIFORMITY_LIMITS.dE00.recommended} soll) · Kontrastabweichung max T ${f(u.maxT, 3)} ${badge(u.contrastOk ? 'gut' : 'aus', u.contrastOk ? '< 0,1' : '≥ 0,1')}</p>
${u.warnings.map((w) => `<p class="note">⚠ ${esc(w)}</p>`).join('')}
<table>${grid}</table>
<p class="note">Je Feld: größtes ΔE00 zum Mittelfeld über alle Stufen, Leuchtdichteabweichung je Stufe, CCT bei 100 %, Kontrastabweichung T = |R/R_Mitte − 1| mit R = Y50/Y100. Grenzwerte ISO 14861 wie in DisplayCAL zitiert; die Norm selbst wurde nicht eingesehen.</p>
</body></html>`;
}

/** Offer a text file for download (browser). */
export function download(name: string, text: string, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
