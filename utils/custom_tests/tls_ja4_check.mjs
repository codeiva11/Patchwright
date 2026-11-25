// TLS/JA4 alignment check — verifies that the launched system browser's TLS
// ClientHello fingerprint matches genuine Chrome's (the identity it claims).
// Reference: Chrome 152+ JA4 = t13d1517h2_8daaf6152771_cb7bf5808d99
// The PASS invariant is the prefix (protocol+cipher classes, cipher hash, and the
// trust_anchors extension that separates 17h2 from 16h2). The trailing extensions
// hash is platform/version sensitive (Windows vs Linux builds differ), so the full
// hash is logged for observability but not exact-matched.
// Usage: node utils/custom_tests/tls_ja4_check.mjs <browser.exe path?>
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
process.env.NODE_ENV ??= 'test';

const exe = process.argv[2] || undefined;
if (exe && !existsSync(exe)) { console.error('executable not found:', exe); process.exit(2); }

// Resolve the built patchwright-core first (repo CI layout: playwright/packages/...),
// then a locally installed patchwright-core, then the vanilla playwright-core build.
let _mod;
if (existsSync(new URL('../../playwright/packages/patchwright-core/index.mjs', import.meta.url))) {
  _mod = await import(new URL('../../playwright/packages/patchwright-core/index.mjs', import.meta.url));
} else if (existsSync(new URL('../../playwright/packages/playwright-core/index.mjs', import.meta.url))) {
  _mod = await import(new URL('../../playwright/packages/playwright-core/index.mjs', import.meta.url));
} else {
  _mod = await import(pathToFileURL(require.resolve('patchwright-core')).href);
}
const { chromium } = _mod.chromium ? _mod : _mod.default;
const EXPECTED_JA4 = 't13d1517h2_8daaf6152771_cb7bf5808d99';
const EXPECTED_HTTP2 = '52d84b11737d980aef856699f885ca86';

const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
const page = await (await browser.newContext()).newPage();
await page.goto('https://tls.peet.ws/api/all', { timeout: 60000 }).catch(() => { });
const body = await page.evaluate(() => document.body.innerText).catch(() => '');
await browser.close();

const d = JSON.parse(body);
const ja4 = d.tls?.ja4;
const http2 = d.http2?.akamai_fingerprint_hash;
console.log('browser :', exe || 'auto-resolved');
console.log('JA4     :', ja4);
console.log('HTTP2   :', http2);
let ok = true;
if (!ja4 || !ja4.startsWith('t13d1517h2_8daaf6152771')) { console.log('FAIL: JA4 does not match genuine Chrome profile (expected prefix t13d1517h2_8daaf6152771)', EXPECTED_JA4); ok = false; }
else console.log('PASS: JA4 matches genuine Chrome profile');
if (http2 !== EXPECTED_HTTP2) { console.log('WARN: HTTP/2 akamai fingerprint differs (non-fatal):', EXPECTED_HTTP2); }
process.exit(ok ? 0 : 1);
