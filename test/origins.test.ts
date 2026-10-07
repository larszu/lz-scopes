import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OriginStore, clockAccess, consentPage, newNonce, normalizeOrigin, takeNonce } from '../server/origins.mjs';

describe('allowed web origins for /clock', () => {
  it('normalises strictly: https, no paths, no wildcards', () => {
    expect(normalizeOrigin('https://larszu.github.io')).toBe('https://larszu.github.io');
    expect(normalizeOrigin('https://larszu.github.io/')).toBe('https://larszu.github.io');
    expect(normalizeOrigin('https://larszu.github.io/lz-scopes/')).toBeNull();
    expect(normalizeOrigin('https://*.github.io')).toBeNull();
    expect(normalizeOrigin('http://example.com')).toBeNull();
    expect(normalizeOrigin('http://localhost:4194')).toBe('http://localhost:4194');
    expect(normalizeOrigin('https://user:pw@example.com')).toBeNull();
    expect(normalizeOrigin('null')).toBeNull();
  });
  it('exact match only, saved to the file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lzs-origins-')), 'sub', 'allowed-origins.json');
    const st = new OriginStore(file);
    expect(st.add('https://larszu.github.io/')).toBe('https://larszu.github.io');
    expect(st.has('https://larszu.github.io')).toBe(true);
    expect(st.has('https://evil.github.io')).toBe(false);
    expect(st.has('https://larszu.github.io.evil.com')).toBe(false);
    expect(st.has('http://larszu.github.io')).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['https://larszu.github.io']);
    expect(new OriginStore(file).list()).toEqual(['https://larszu.github.io']);
    st.remove('https://larszu.github.io');
    expect(new OriginStore(file).list()).toEqual([]);
  });
  it('access: loopback only; same origin or allowed origin', () => {
    const st = new OriginStore(null);
    st.allowTemporarily('https://larszu.github.io');
    const host = '127.0.0.1:4192';
    expect(clockAccess({ remote: '127.0.0.1', origin: 'http://127.0.0.1:4192', host, store: st })).toBeNull();
    expect(clockAccess({ remote: '127.0.0.1', origin: 'https://larszu.github.io', host, store: st })).toBeNull();
    expect(clockAccess({ remote: '127.0.0.1', origin: 'https://other.example', host, store: st })?.status).toBe(403);
    expect(clockAccess({ remote: '192.168.1.5', origin: 'https://larszu.github.io', host, store: st })?.status).toBe(403);
    expect(clockAccess({ remote: '::1', host, store: st })).toBeNull();
  });
  it('nonces are single use; the consent page escapes the origin', () => {
    const n = newNonce();
    expect(takeNonce(n)).toBe(true);
    expect(takeNonce(n)).toBe(false);
    expect(takeNonce(newNonce(0), 10 * 60 * 1000)).toBe(false);
    const html = consentPage('https://a.example/"><script>', new OriginStore(null), 'x');
    expect(html).not.toContain('<script>');
    expect(consentPage('https://larszu.github.io', new OriginStore(null), 'x')).toContain('Diese Web-Oberfläche zulassen');
  });
});
