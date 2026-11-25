// Patchwright service-worker identity smoke test.
// A service worker is a separate target: per-page CDP overrides do not change
// WorkerNavigator, so this test guards the browser-process --user-agent path.
import http from 'node:http';
import fs from 'node:fs';

let chromium;
if (fs.existsSync(new URL('../../playwright/packages/patchwright-core/index.mjs', import.meta.url))) {
  ({ chromium } = await import('../../playwright/packages/patchwright-core/index.mjs'));
} else if (fs.existsSync(new URL('../../playwright/packages/playwright-core/index.mjs', import.meta.url))) {
  ({ chromium } = await import('../../playwright/packages/playwright-core/index.mjs'));
} else {
  ({ chromium } = await import('patchwright'));
}

const workerScript = `
self.addEventListener('message', async event => {
  const uaData = navigator.userAgentData;
  const hev = uaData ? await uaData.getHighEntropyValues(['brands', 'fullVersionList', 'platformVersion']) : null;
  event.source.postMessage({ ua: navigator.userAgent, appVersion: navigator.appVersion, hev });
});
`;

const server = http.createServer((req, res) => {
  if (req.url === '/sw.js') {
    res.setHeader('content-type', 'application/javascript');
    return res.end(workerScript);
  }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html>
<script>
navigator.serviceWorker.register('/sw.js').then(async registration => {
  await navigator.serviceWorker.ready;
  (navigator.serviceWorker.controller || registration.active).postMessage('probe');
});
navigator.serviceWorker.onmessage = event => { window.__sw = event.data; };
</script>`);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(origin + '/');
  await page.waitForFunction(() => window.__sw, undefined, { timeout: 15000 });
  const result = await page.evaluate(() => window.__sw);
  const failures = [];
  if (/HeadlessChrome/.test(result.ua)) failures.push('worker userAgent contains HeadlessChrome');
  if (/HeadlessChrome/.test(result.appVersion)) failures.push('worker appVersion contains HeadlessChrome');
  const brands = result.hev?.brands?.map(item => item.brand) || [];
  if (!brands.includes('Google Chrome')) failures.push('worker brands missing Google Chrome');
  if (!result.hev?.fullVersionList?.length) failures.push('worker fullVersionList empty');
  // Linux Chrome natively reports an empty platformVersion; only require it on
  // platforms where Chromium exposes one.
  if (process.platform !== 'linux' && !result.hev?.platformVersion) failures.push('worker platformVersion empty');
  if (failures.length) {
    console.error('FAIL  service worker identity');
    for (const failure of failures) console.error('  - ' + failure);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log('PASS  service worker userAgent/appVersion/Client Hints');
  }
} finally {
  await browser.close();
  server.close();
}
