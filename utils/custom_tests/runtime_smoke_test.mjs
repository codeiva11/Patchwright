// Patchwright runtime smoke test for the new core patches.
// Notes:
//  - page.evaluate runs in the MAIN world by default (Playwright-compatible).
//    The fourth `isolatedContext` argument still opts into the utility world.
//  - Fingerprint assertions read the MAIN world, exactly like a real page script.
import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

let chromium;
if (fs.existsSync(new URL('../../playwright/packages/patchwright-core/index.mjs', import.meta.url))) {
  ({ chromium } = await import('../../playwright/packages/patchwright-core/index.mjs'));
} else if (fs.existsSync(new URL('../../playwright/packages/playwright-core/index.mjs', import.meta.url))) {
  ({ chromium } = await import('../../playwright/packages/playwright-core/index.mjs'));
} else {
  ({ chromium } = await import('patchwright'));
}

const results = [];
const check = (name, ok, extra = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`);
};

const pageHtml = `<!doctype html>
<h1>patchwright</h1>
<canvas id="c" width="80" height="60"></canvas>
<script>
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3477aa';
  ctx.fillRect(0, 0, 80, 60);
</script>`;

const marker = 'pw-smoke-marker-8712';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(pageHtml);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

try {
  let browser;
  // 1) Fingerprint spoofing (env-driven).
  process.env.PATCHWRIGHT_FINGERPRINT = JSON.stringify({
    hardwareConcurrency: 16,
    deviceMemory: 16,
    canvasNoise: true,
    webglVendor: 'Intel',
    webglRenderer: 'Intel Iris OpenGL Engine',
    permissions: { granted: ['geolocation'] },
  });
  browser = await chromium.launch({ headless: true, args: [`--${marker}`] });
  const page = await browser.newPage();
  await page.goto(url);

  // Main-world reads (isolatedContext: false) - what a real page / detector sees.
  const main = fn => page.evaluate(fn, undefined, undefined, false);
  const hw = await main(() => ({ cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory }));
  check('hardwareConcurrency/deviceMemory spoof', hw.cores === 16 && hw.mem === 16, JSON.stringify(hw));

  const gl = await main(() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl');
    const ext = g.getExtension('WEBGL_debug_renderer_info');
    return { vendor: g.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: g.getParameter(ext.UNMASKED_RENDERER_WEBGL) };
  });
  check('WebGL vendor/renderer spoof', gl.vendor === 'Intel' && gl.renderer === 'Intel Iris OpenGL Engine', JSON.stringify(gl));

  // canvas noise: two main-world reads must be identical (deterministic), and some pixels
  // must deviate from the flat #3477aa fill (52,119,170) that was painted.
  const [noisy1, noisy2, noiseStats] = await main(() => [
    document.getElementById('c').toDataURL(),
    document.getElementById('c').toDataURL(),
    (() => {
      const data = document.getElementById('c').getContext('2d').getImageData(0, 0, 80, 60).data;
      let deviated = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] !== 52) deviated++;
      return { deviated, total: data.length / 4 };
    })(),
  ]);
  check('canvas noise deterministic', noisy1 === noisy2);
  check('canvas noise applied', noiseStats.deviated > 0 && noiseStats.deviated < noiseStats.total / 2, JSON.stringify(noiseStats));

  // permissions consistency
  const perm = await main(async () => (await navigator.permissions.query({ name: 'geolocation' })).state);
  check('Permissions API spoof (granted)', perm === 'granted', perm);

  // UA + Client Hints must be native, not a guessed brand list.
  const ua = await main(async () => ({
    ua: navigator.userAgent,
    brands: navigator.userAgentData ? (await navigator.userAgentData.getHighEntropyValues(['brands', 'fullVersionList'])).brands : [],
    full: navigator.userAgentData ? (await navigator.userAgentData.getHighEntropyValues(['fullVersionList'])).fullVersionList : [],
  }));
  check('UA has no HeadlessChrome', !ua.ua.includes('HeadlessChrome'), ua.ua);
  check('Client Hints brands populated', Array.isArray(ua.brands) && ua.brands.length > 0, JSON.stringify(ua.brands));
  check('Client Hints full versions populated', Array.isArray(ua.full) && ua.full.length > 0, JSON.stringify(ua.full));

  // Lazy Runtime.enable: console and pageerror must work only after a listener.
  let consoleSeen = false;
  let pageErrorSeen = false;
  page.on('console', message => { if (message.text() === 'pw-console-probe') consoleSeen = true; });
  page.on('pageerror', () => { pageErrorSeen = true; });
  await main(() => {
    console.log('pw-console-probe');
    setTimeout(() => { throw new Error('pw-pageerror-probe'); }, 0);
  });
  await page.waitForTimeout(250);
  check('console event after listener', consoleSeen);
  check('pageerror event after listener', pageErrorSeen);

  // exposeFunction wrapper must not expose callbacks/handles and must look native.
  await page.exposeFunction('pwExposedProbe', () => 1);
  const binding = await main(() => {
    const fn = window.pwExposedProbe;
    return {
      keys: Object.keys(fn),
      own: Object.getOwnPropertyNames(fn),
      symbols: Object.getOwnPropertySymbols(fn).length,
      source: Function.prototype.toString.call(fn),
    };
  });
  check('exposeFunction has no enumerable state', binding.keys.length === 0, JSON.stringify(binding.keys));
  check('exposeFunction exposes no symbol registry', binding.symbols === 0, String(binding.symbols));
  check('exposeFunction looks native', binding.source.includes('[native code]') && !binding.source.includes('callbacks'), binding.source);

  // 2) Launch flags: read the browser process command line via its unique marker arg.
  let cmdline = '';
  try {
    if (process.platform === 'win32') {
      const powershell = `Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'chrome*' -and $_.CommandLine -like '*${marker}*' } | Select-Object -First 1 -ExpandProperty CommandLine`;
      cmdline = execSync(`powershell -NoProfile -Command "${powershell}"`, { encoding: 'utf8' });
    } else {
      cmdline = execSync(`ps -eo args= | grep -F -- ${marker} | head -n 1`, { encoding: 'utf8' });
    }
  } catch {
    cmdline = '';
  }
  check('browser process found', cmdline.includes(marker), cmdline.slice(0, 120));
  // No proxy in this launch: leave Chromium's native WebRTC policy untouched.
  // With a proxy, the driver adds disable_non_proxied_udp instead.
  check('WebRTC policy is native without a proxy', !cmdline.includes('--webrtc-ip-handling-policy') && !cmdline.includes('--enforce-webrtc-ip-permission-check'));
  check('AutomationControlled blink flag', cmdline.includes('--disable-blink-features=AutomationControlled'));
  check('No --enable-automation flag', !cmdline.includes('--enable-automation'));
  check('No forced --no-sandbox flag', !cmdline.includes('--no-sandbox'));
  check('Native UA launch switch present', cmdline.includes('--user-agent='));
  check('Neutral temp profile name', cmdline.includes('pw_chromium_profile-') && !cmdline.includes('dev_profile-'));

  // 3) Human input simulation.
  await page.mouse.moveHuman(300, 220);
  check('mouse.moveHuman', true);
  await page.keyboard.typeHuman('hello patchwright');
  check('keyboard.typeHuman', true);
  await page.mouse.scrollHuman(600);
  check('mouse.scrollHuman', true);

  // 4) driver leak check: navigator.webdriver (main world)
  const webdriver = await main(() => navigator.webdriver);
  check('navigator.webdriver is false', webdriver === false, String(webdriver));

  await browser.close();

  // 5) System browser channel resolution error path (Brave not installed on this machine).
  try {
    const brave = await chromium.launch({ channel: 'brave', headless: true });
    await brave.close();
    check('brave channel', true, 'launched');
  } catch (error) {
    check('brave channel recognized', String(error).includes("'brave' is not found"), String(error).split('\n')[0]);
  }
} catch (error) {
  results.push('FATAL ' + error);
} finally {
  try { await browser?.close(); } catch { }
  server.close();
  console.log(results.join('\n'));
  process.exitCode = results.some(line => line.startsWith('FAIL') || line.startsWith('FATAL')) ? 1 : 0;
}
