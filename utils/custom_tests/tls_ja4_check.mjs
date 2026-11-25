// TLS/JA4 alignment check — verifies that the launched system browser's TLS
// ClientHello fingerprint matches genuine Chrome's (the identity it claims).
// Reference: Chrome 152+ JA4 = t13d1517h2_8daaf6152771_cb7bf5808d99
// Usage: node utils/custom_tests/tls_ja4_check.mjs <browser.exe path?>
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
process.env.NODE_ENV ??= 'test';

const exe = process.argv[2] || undefined;
if (exe && !existsSync(exe)) { console.error('executable not found:', exe); process.exit(2); }

const req = createRequire(path.join(process.cwd(), 'package.json'));
const _mod = await import(pathToFileURL(req.resolve('patchwright-core')).href);
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
if (ja4 !== EXPECTED_JA4) { console.log('FAIL: JA4 does not match genuine Chrome profile', EXPECTED_JA4); ok = false; }
else console.log('PASS: JA4 matches genuine Chrome profile');
if (http2 !== EXPECTED_HTTP2) { console.log('WARN: HTTP/2 akamai fingerprint differs (non-fatal):', EXPECTED_HTTP2); }
process.exit(ok ? 0 : 1);
