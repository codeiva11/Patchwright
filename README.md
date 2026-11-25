<h1 align="center">
    🎭 Patchwright
</h1>

<p align="center">
    <a href="./LICENSE">
        <img src="https://img.shields.io/badge/License-Apache%202.0-green" alt="License">
    </a>
    <a>
        <img src="https://img.shields.io/badge/Based%20on-Playwright-goldenrod" alt="Based on Playwright">
    </a>
    <a>
        <img src="https://img.shields.io/badge/Driver-Patched-blue" alt="Driver Patched">
    </a>
    <a>
        <img src="https://img.shields.io/badge/Stealth-Undetected-success" alt="Stealth Undetected">
    </a>
    <a>
        <img src="https://img.shields.io/badge/NPM-OIDC%20Provenance-brightgreen" alt="OIDC Provenance">
    </a>
</p>

<h4 align="center">
    Patchwright is a build-time patched, drop-in replacement for Microsoft Playwright.<br/>
    It removes many driver-level automation signals. No browser stack can guarantee 100% undetectability against every current or future detector.
</h4>

> [!IMPORTANT]  
> **Patchwright exclusively patches CHROMIUM-based browsers** (Google Chrome, Microsoft Edge, Chromium). Firefox and WebKit are not supported.

---

## 📑 Table of Contents

- [Why Patchwright?](#-why-patchwright)
- [Stealth & Anti-Bot Verification](#-stealth--anti-bot-verification)
- [Core Technical Patches](#-core-technical-patches)
- [Quick Start for Users](#-quick-start-for-users)
- [Local Development & Setup Guide](#-local-development--setup-guide)
- [All Commands Reference](#-all-commands-reference)
- [Testing & Verification](#-testing--verification)
- [GitHub Actions & OIDC NPM Publishing](#-github-actions--oidc-npm-publishing)
- [License & Disclaimer](#-license--disclaimer)

---

## 🛡️ Why Patchwright?

Standard Playwright is easily detected by modern anti-bot vendors because of internal Chrome DevTools Protocol (CDP) signatures, automatic command-line flags, and global variables injected into web pages.

Unlike runtime stealth wrappers (which inject JavaScript after page creation and can be caught via timing attacks or prototype inspection), **Patchwright modifies Playwright's core driver at build-time using TypeScript AST transformation (`ts-morph`)**.

---

## 🎯 Stealth & Anti-Bot Verification

Patchwright targets the checks below. The repository's local smoke tests cover the driver-side signals; third-party detector outcomes are not continuously verified and must not be read as a guarantee:

| Anti-Bot / Detector | Status | Relevant driver-side coverage |
| :--- | :---: | :--- |
| **[Brotector](https://kaliiiiiiiiii.github.io/brotector/)** | ⚪ Not live-verified| Removes CDP `Runtime.enable` leaks and Error stack inspection |
| **[Cloudflare WAF / Turnstile](https://cloudflare.com/)** | ⚪ Not live-verified| Strips automation flags and `navigator.webdriver`; optional flag-level TLS alignment, no live guarantee |
| **[DataDome](https://datadome.co/)** | ⚪ Not live-verified| Zero `__pwInitScripts` or `__playwright__binding__` scope leaks |
| **[Akamai Bot Manager](https://www.akamai.com/)** | ⚪ Not live-verified| Real Chrome launch switches and presentation API alignment |
| **[Kasada](https://www.kasada.io/)** | ⚪ Not live-verified| Native execution timing and clean context isolation |
| **[Shape / F5](https://www.f5.com/)** | ⚪ Not live-verified| Undetected CDP execution contexts |
| **[CreepJS](https://abrahamjuliot.github.io/creepjs/)** | ⚪ Not live-verified| Trust score > 85%, clean canvas, audio, and CDP fingerprint |
| **[Sannysoft](https://bot.sannysoft.com/)** | ⚪ Not live-verified| `navigator.webdriver = false`, full Chrome property alignment |
| **[Fingerprint.com](https://fingerprint.com/)** | ⚪ Not live-verified| Zero browser automation signals |
| **[Pixelscan](https://pixelscan.net/)** | ⚪ Not live-verified| Chrome brand alignment, `navigator.brave` deleted natively, Brave farbling disabled, dynamic full-version Client-Hints |
| **[Browserscan](https://browserscan.net/)** | ⚪ Not live-verified| No IP/interface mismatch (WebRTC policy), authentic Chrome identity `158.x` |
| **[IPHey](https://iphey.com/)** | ⚪ Not live-verified| Trustworthy browser fingerprint |

---

### Feature Checklist (implemented; local smoke coverage)

| # | Feature | Env / API |
| :---: | :--- | :--- |
| ✅ | `Runtime.enable` / `Console.enable` startup leak elimination | automatic (lazy on console listeners) |
| ✅ | Automation flag neutralization (`navigator.webdriver = false`) | automatic |
| ✅ | Zero global leaks for `addInitScript` / `exposeFunction` | automatic |
| ✅ | Closed shadow roots + XPath support | automatic |
| ✅ | System-browser-first launch, **no bundled Chrome-for-Testing download** | automatic |
| ✅ | Chrome → Chromium → Brave auto-resolution (+ `~/.patchwright` managed binary) | `PATCHWRIGHT_BINARY` |
| ✅ | System browser identity alignment (UA token, brands, dynamic full versions, `navigator.brave` deletion) | automatic (`PATCHWRIGHT_SYSTEM_STEALTH=0` to opt out) |
| ⚪ | Optional flag-level TLS extension alignment; not a binary ClientHello patch | automatic (`PATCHWRIGHT_TLS_ALIGN=0` to opt out) |
| ✅ | WebRTC IP leak protection with a proxy (native policy without one) | `PATCHWRIGHT_WEBRTC_POLICY` |
| ✅ | Brave farbling auto-disable (canvas/audio/hardware farbling off) | automatic (`PATCHWRIGHT_BRAVE_FARBLING=0` to opt out) |
| ✅ | Human-like input (`moveHuman` / `scrollHuman` / `typeHuman`) | API |
| ✅ | Proxy geo-alignment (timezone / locale / geolocation) | `geoAlign: true` / `PATCHWRIGHT_GEO_ALIGN=1` |
| ✅ | Fingerprint alignment (hardware, WebGL, canvas, permissions) | `PATCHWRIGHT_FINGERPRINT` / `PATCHWRIGHT_PERMISSIONS` |
| ✅ | **Auto-install a system browser when none is found** (winget/official installers on Windows, brew/dmg on macOS, flatpak/native packages on Linux) | automatic (`PATCHWRIGHT_AUTO_INSTALL=0` to opt out) |
| ✅ | Neutral temp profiles (`pw_*_profile-`) | automatic |
| ✅ | Local smoke tests cover the driver and fingerprint paths; live-detector results vary by detector, network and browser build | see Testing |

## 🔧 Core Technical Patches

### 1. ✅ `Runtime.enable` Leak Elimination
Standard Playwright enables CDP `Runtime.enable` at startup, which exposes automation to V8 runtime getters. Patchwright does not enable it during launch. It is enabled lazily only if the page code asks for `console` messages or `pageerror` events, because Chrome cannot deliver those events without the domain.

### 2. ✅ `Console.enable` CDP Domain Disabled
Patchwright does not enable the CDP `Log` or `Console` domain during startup. Console output is pulled on demand when a listener is attached.

### 3. ✅ Chromium Command Flag Neutralization
Patchwright modifies default browser launch arguments:
* **Added:** `--disable-blink-features=AutomationControlled` (forces `navigator.webdriver = false`).
* **Removed:** `--enable-automation` (prevents automation banners and flags).
* **Removed:** `--disable-popup-blocking`, `--disable-component-update`, `--disable-default-apps`, `--disable-extensions`.

### 4. ✅ Zero Global Leaks for `addInitScript` & `exposeFunction`
Standard Playwright exposes globals such as `window.__pwInitScripts` and `__playwright__binding__`. Patchwright registers init scripts through `Page.addScriptToEvaluateOnNewDocument` (no page global) and stores binding callbacks under neutral symbols with a native-looking `Proxy` wrapper. The old network-response HTML injection path is disabled.

### 5. ✅ Closed Shadow Roots & XPath Support
Allows locating and interacting with elements embedded inside **Closed Shadow Roots** using standard Playwright locators and custom XPath selectors.

### 6. ✅ System-Browser-First Launch & Patched Binary Auto-Load (no bundled download)
Patchwright launches pre-installed browsers natively: `channel: 'chrome'`, `'msedge'`, plus new channels `'brave'`, `'brave-beta'`, `'vivaldi'`, `'opera'` and `'chromium-system'`. With no explicit target it auto-resolves an official system browser (Google Chrome → Chromium → Brave; Microsoft Edge is excluded from auto-discovery because Cloudflare's managed-challenge scoring rejects Edge sessions). **The bundled Chrome-for-Testing registry is never used or downloaded** — resolution order: `executablePath` → `PATCHWRIGHT_BINARY` / `PATCHWRIGHT_EXECUTABLE_PATH` → `~/.patchwright/patchwright-chromium` → system browsers; a clean error (no install suggestion) if nothing is found. Temporary profiles use neutral names (`pw_*_profile-`), never `playwright_*_dev_profile-`.

### 7. ✅ WebRTC IP Leak Protection
When a proxy is configured, Patchwright sends `--webrtc-ip-handling-policy=disable_non_proxied_udp` plus `--enforce-webrtc-ip-permission-check`, so WebRTC does not expose a non-proxied interface IP. Without a proxy it leaves native WebRTC behaviour intact, because forcing the policy on a direct connection is itself a fingerprint. Override with `PATCHWRIGHT_WEBRTC_POLICY=<chromium policy value>`.

### 8. ✅ WebRTC Policy (`PATCHWRIGHT_WEBRTC_POLICY`)

With a proxy, Patchwright sets `--webrtc-ip-handling-policy=disable_non_proxied_udp` so
WebRTC does not expose a non-proxied interface IP. Without a proxy the native policy is kept.
Override the policy value with `PATCHWRIGHT_WEBRTC_POLICY=default_public_interface_only` (or
any other Chromium policy value).

### 9. ✅ Human-Like Input Simulation (client-side, opt-in)
```js
await page.mouse.moveHuman(300, 220);            // Bézier curve + acceleration/deceleration + micro-jitter (Fitts's Law)
await page.mouse.scrollHuman(600);              // inertial momentum scrolling with easing
await page.keyboard.typeHuman('hello world');   // Gaussian keystroke delays + occasional typo/backspace
```

### 10. ✅ Proxy → Timezone / Geolocation / Language Auto-Alignment
Pass `geoAlign: true` (or set `PATCHWRIGHT_GEO_ALIGN=1`) to `chromium.launchPersistentContext` or `browser.newContext()`. A probe page fetches a geo-IP endpoint through the browser (and therefore through the proxy) and the timezone, locale and geolocation are applied to the context automatically. Endpoint is configurable via `PATCHWRIGHT_GEO_ENDPOINT` (default `https://ipinfo.io/json`).

### 11. ✅ Brave Shields Farbling Auto-Disable (system Brave)

Brave seeds canvas/audio/hardware farbling on every fresh profile, which fingerprint
checkers (pixelscan C14) read as "masking". When Patchwright launches Brave
(`channel: 'brave'` or a Brave executable), it automatically seeds the fresh temp
profile's Preferences with Brave-shields-v2 content settings
(`fingerprintingV2` / `httpsUpgrades` disabled globally) so the engine reports
exact, authentic values. Opt out with `PATCHWRIGHT_BRAVE_FARBLING=0`.

### 12. ✅ System Browser Identity Alignment (system Brave/Edge/Chrome/Chromium)

When a system browser is launched through the driver, Patchwright aligns its native identity
with the Chrome identity the UA claims, using a single native `Network.setUserAgentOverride`:

* **HeadlessChrome → Chrome token fix** (Brave/Chromium keep the token even with `--headless=new`).
* **Client-Hints brand alignment**: Edge keeps its native Edge brands; Brave keeps its native
  Brave brand; Chrome and Chromium expose their real brand list with grease rotation. Patchwright
  never appends a fake `Google Chrome` entry to another vendor's brand list.
* **Dynamic full versions**: the browser binary's real build is read via `--version` at launch
  and surfaced through `fullVersionList` / `uaFullVersion` — nothing hardcoded. The UA string
  stays in Chrome's authentic reduced format (`Chrome/158.0.0.0`); `fullVersionList` carries the
  full build. For Edge, the Chromium entry is derived from the Edge product version, so it can
  differ from Edge's native Chromium base version.
* **`navigator.brave` is hidden** by deleting it on the instance and `Navigator.prototype`;
  `Object.getOwnPropertyNames(navigator)` stays empty, like real Chrome. This is a JS-level
  property deletion, not a binary patch. Opt out with `PATCHWRIGHT_SYSTEM_STEALTH=0`.
* **`navigator.brave` removed in Web Workers too** — Brave exposes it in dedicated worker
  realms (`WorkerNavigator`), where page init scripts never run; Patchwright deletes it in
  every worker session before the worker's own scripts execute.

### 13. ✅ TLS / JA4 Alignment (`PATCHWRIGHT_TLS_ALIGN`)

Chromium 152+ sends the `trust_anchors` (0xCA34) extension in every ClientHello, which moves
JA4 from `t13d1516h2` to `t13d1517h2` — the fingerprint every server sees **before any page
code runs**. Chrome and Edge ship it by default; Brave does not, so Brave's ClientHello looked
one Chromium generation older than the Chrome identity it claims. Patchwright always launches
with `--enable-features=TLSTrustAnchorIDs`. The local check verifies the Chrome 17h2 JA4 prefix
(`t13d1517h2_8daaf6152771`); the full extension hash can vary by platform/build, and HTTP/2 is
logged as advisory, not exact-matched. Not a binary ClientHello patch, and not a guarantee
against every TLS fingerprinting stack. See [utils/custom_tests/tls_ja4_check.mjs](utils/custom_tests/tls_ja4_check.mjs).
Opt out with `PATCHWRIGHT_TLS_ALIGN=0`.

### 14. ✅ Opt-in Fingerprint Alignment (`PATCHWRIGHT_FINGERPRINT`)
Set `PATCHWRIGHT_FINGERPRINT=<json>` to align hardware and rendering fingerprints for every context:

```bash
export PATCHWRIGHT_FINGERPRINT='{"hardwareConcurrency":16,"deviceMemory":16,"canvasNoise":true,"webglVendor":"Intel","webglRenderer":"Intel Iris OpenGL Engine","permissions":{"granted":["geolocation"]}}'
```

* `hardwareConcurrency` / `deviceMemory` / `platform` / `userAgent` — report a desktop-class machine.
* `webglVendor` / `webglRenderer` — spoof `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL`.
* `canvasNoise` — deterministic, per-page-load micro-noise on `toDataURL`, `toBlob` and `getImageData` (stable across repeated reads, unique across sessions).
* `permissions` — align `navigator.permissions.query` states (`granted`, `denied`, notification consistency).

CDP-level permission grants (invisible to pages, no injection) are available via `PATCHWRIGHT_PERMISSIONS=notifications,geolocation` or `PATCHWRIGHT_PERMISSIONS=all`.

> ℹ️ These JS-level overrides run in the main world through a CDP init script and are opt-in. They
> are not native binary edits. [driver_patches/BINARY_LAYER_SPEC.md](driver_patches/BINARY_LAYER_SPEC.md)
> is a design document for a binary layer that this repository does not implement.

### 15. ✅ Automatic System-Browser Installation (`PATCHWRIGHT_AUTO_INSTALL`)

If a machine has **no official system browser installed** (Brave, Google Chrome, Chromium),
Patchwright installs one automatically before launching — official vendor sources only,
never Chrome-for-Testing builds:

| OS | Install order |
| :--- | :--- |
| **Windows** | `winget install Brave.Brave` → `winget install Google.Chrome` (user scope first) → official Brave standalone installer → official Chrome MSI |
| **macOS** | `brew install --cask brave-browser` → `google-chrome` → official Brave dmg (`hdiutil` mount, `~/Applications` also scanned) |
| **Linux** | `flatpak install --user com.brave.Browser` / `com.google.Chrome` (no root, Flathub-verified) → official Brave **apt repository** (GPG-verified packages, no curl-pipe-to-shell) → Chrome `.deb`/`.rpm` → distro `chromium` packages (`sudo -n` only — a password prompt would hang the pipeline) |

**Hardening:** downloaded installers are **signature-verified before execution** (Authenticode on Windows, `codesign` + `spctl` on macOS); concurrent launches share a **single-flight** installation attempt; a failed attempt is never retried within the process (relaunches fail fast); Linux scans also cover `/usr/local/bin` and Flatpak exports.

After any successful install the browser scan re-runs and launches the newly installed
browser. Opt out with `PATCHWRIGHT_AUTO_INSTALL=0`; if installation is not possible the
original instructive error is thrown.

---

## 💻 Local Development & Setup Guide

If you are developing, modifying patches, or building Patchwright from source:

### Prerequisites
* **Node.js:** v20.x or v24.x (recommended)
* **Git:** Installed and available in PATH
* **Package Manager:** npm (v9.5.0+ or v10+)

### 1. Clone the Repository
```bash
git clone https://github.com/codeiva11/Patchwright.git
cd Patchwright
npm install
```

### 2. Build the Patched Driver (Cross-Platform)

#### Option A: Full Local Build — Step by Step (works on Windows PowerShell, Git Bash, Linux & macOS)

This is exactly the flow used to produce the local `patchwright-core` package:

```bash
# 1. Clone the Patchwright repository and install its dev dependencies
git clone https://github.com/codeiva11/Patchwright.git
cd Patchwright
npm install

# 2. Clone the upstream Playwright source that will be patched (pick the release you target)
git clone https://github.com/microsoft/playwright --branch v1.65.1 playwright

# 3. Install Playwright's internal dependencies
cd playwright
npm ci
cd ..

# 4. Apply all Patchwright AST patches (driver + client + fingerprint + launch pipeline)
npm run patch

# 5. Compile the patched Playwright codebase
#    (run twice: after a fresh clone the first parallel generate_channels race is retried)
cd playwright
node utils/generate_channels.js || true
npm run build
npm run build
cd ..

# 6. Rebrand the built packages to `patchwright` / `patchwright-core`
cd playwright
npx tsx ../utils/patchwright_rebranding.ts
cd ..

# 7. Pack local installable tarballs into the repository root
cd playwright/packages/patchwright-core
npm pack --pack-destination ../../..
cd ../patchwright
npm pack --pack-destination ../../..
cd ../../..
# -> creates  patchwright-core-<version>.tgz  (patchwright-<version>.tgz is optional:
#    only needed for the test-runner wrapper; API/automation users need patchwright-core only)
```

> **Re-running after patch changes:** the `playwright/` tree must be clean before `npm run patch`
> (the patch pipeline is not idempotent). Reset it first:
> ```bash
> cd playwright && git reset --hard && git clean -fd && cd ..
> ```
> then re-run steps 4-7 (no need to re-run `npm ci` unless dependencies changed).

#### Option B: One-Command Rebuild (Linux / macOS / Git Bash)
```bash
npm run rebuild
# then rebrand + pack as in steps 6-7 above
```

### 3. Include the Local Build in Your Own Project and Test It

In **your** project (anywhere on the machine), install the local tarballs:

```bash
# from your project directory
cd path/to/your-project
npm init -y   # if there is no package.json yet

# install the locally built packages (adjust the paths to your Patchwright checkout)
npm i -D "C:/path/to/Patchwright/patchwright-core-<version>.tgz" \
         "C:/path/to/Patchwright/patchwright-<version>.tgz"

# no browser download is needed - Patchwright auto-resolves an official system browser
# (Brave -> Chrome -> Chromium); optionally point at one explicitly:
#   PATCHWRIGHT_BINARY="C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe"
#   or channel: 'brave' / 'msedge' / 'chrome' in launch options
```

Example test script (`test.mjs`):

```js
import { chromium } from 'patchwright-core';

// opt-in fingerprint alignment (see features above)
process.env.PATCHWRIGHT_FINGERPRINT = JSON.stringify({
  hardwareConcurrency: 16,
  deviceMemory: 16,
  canvasNoise: true,
  webglVendor: 'Intel',
  webglRenderer: 'Intel Iris OpenGL Engine',
  permissions: { granted: ['geolocation'] },
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://bot.sannysoft.com/');

// human-like interaction
await page.mouse.moveHuman(300, 220);
await page.keyboard.typeHuman('patchwright local ok');
await page.mouse.scrollHuman(600);

await page.screenshot({ path: 'detection_result.png' });
await browser.close();
```

```bash
node test.mjs
# -> should run cleanly and show navigator.webdriver = false on the detection page
```

> The published packages are a drop-in replacement for Playwright, so you can also just swap
> `playwright` -> `patchwright-core` (library) or `@playwright/test` -> `patchwright`
> (runner) in your imports and uninstall the originals.

#### Quick feature flags for local testing

```bash
PATCHWRIGHT_FINGERPRINT='{"hardwareConcurrency":16,"deviceMemory":16,"canvasNoise":true}' node test.mjs
PATCHWRIGHT_PERMISSIONS=all              node test.mjs   # CDP-level permission grants
PATCHWRIGHT_GEO_ALIGN=1                  node test.mjs   # proxy -> timezone/locale/geo auto-align
PATCHWRIGHT_EXECUTABLE_PATH="C:/path/to/brave.exe" node test.mjs  # patched-binary/system override
```

---

### Upgrading to a New Playwright Version (Auto-Patch Pipeline)

All Patchwright features are **Core-level AST patches** shipped as source transforms in
[`driver_patches/`](driver_patches/) and [`patchwright-nodejs/client_patches/`](patchwright-nodejs/client_patches/).
When a new Playwright release arrives, every feature is re-applied automatically by
re-running the pipeline on the new source — no manual code edits inside the Playwright tree:

```bash
cd playwright
git fetch && git checkout <new-version-tag>
git checkout HEAD -- packages/ && git clean -fdx -e node_modules   # always start from a clean tree
cd ..
npx tsx patchwright_driver_patch.ts                # applies ALL AST patches (driver + client)
npm --prefix playwright run build && npm --prefix playwright run build   # run twice (channel-gen race)
npx tsx utils/patchwright_rebranding.ts
npm pack --prefix playwright/packages/patchwright-core
npm pack --prefix playwright/packages/patchwright
```

Behavior on upstream changes:

* **Unchanged targets apply automatically — 100% coverage.** Transforms are AST-based
  (ts-morph) matched by stable declaration names (`browserType`, `launch`, `addInitScript`,
  `FrameSession`, ...), never by line numbers or copied blobs.
* **Refactored upstream functions fail loudly, never silently.** The pipeline throws at the
  exact patch whose target moved (file/function name in the error); you then update only
  that one patch file while all other features keep applying untouched. This is by design —
  a patch that silently no-ops would be an undetectable security regression.
* **Reproducible builds.** Each run starts from vanilla Playwright (`git checkout HEAD --
  packages/ && git clean`), so the output is deterministic for a given (patch set, version) pair.
* **Post-upgrade verification:** `npm run typecheck` (root),
  `node utils/custom_tests/runtime_smoke_test.mjs`, `node utils/custom_tests/tls_ja4_check.mjs`,
  and the live-detector suite.

### Fixed Builds Between Playwright Versions (no waiting needed)

A fixed build does **not** have to wait for the next upstream Playwright release — and it
keeps the **same version number** as the upstream release (e.g. `1.65.1`). The standard
**Patchwright Release Build and Publish** workflow handles both channels:

* **npm** — published only if that exact version is still free on the registry; if the
  same version already exists there (e.g. a buggy `1.65.1`), npm publishing is skipped
  automatically (`npm view` check before `npm publish`).
* **GitHub** — always: the built tarballs (`patchwright-core-<version>.tgz` and the
  optional test-runner wrapper) are attached to the GitHub release for that same version;
  existing release assets are replaced (`--clobber`) on every run, so a fixed build
  pushed with the same version always lands on GitHub.
* Install the fixed build from GitHub whenever npm already has the version:
  `npm i https://github.com/<owner>/<repo>/releases/download/1.65.1/patchwright-core-1.65.1.tgz`
* No version-suffix scheme and no collision when a real Playwright `1.65.2` ships later.
* Local builds can stamp the version via `PATCHWRIGHT_VERSION=1.65.1` before running
  `npx tsx utils/patchwright_rebranding.ts` (from the `playwright/` directory).

## 📖 All Commands Reference

### Package Scripts (`package.json`)

| Command | Description |
| :--- | :--- |
| `npm run patch` | Applies AST patches to the `./playwright` source code via `patchwright_driver_patch.ts`. |
| `npm run rebrand` | Rebrands compiled packages to `patchwright` and `patchwright-core` via `utils/patchwright_rebranding.ts`. |
| `npm run rebuild` | Clones upstream Playwright, patches, and builds the full local driver package. |
| `npm run test` | Runs the local test suite against the built driver. |
| `npm run typecheck` | Runs TypeScript type checking (`tsc --noEmit`). |
| `npm run format` | Runs automatic indentation fixing and style validation. |
| `npm run format:fix` | Fixes indentation across patches automatically. |
| `npm run format:check` | Validates formatting against Biome and Git diff checks. |

### CLI Commands

Patchwright never downloads or launches bundled Chrome-for-Testing builds, so there is **no
browser-download command at all** — browser resolution is always system-first. Bin names are
distinct (`patchwright` = test-runner wrapper, `patchwright-core` = driver CLI), so installing
both packages never clobbers either command.

| CLI Command | Description |
| :--- | :--- |
| `npx patchwright test` | Run tests — drop-in replacement for `playwright test`. |
| `npx patchwright show-report` | Open the HTML test report. |
| `npx patchwright merge-reports [dir]` | Merge sharded blob reports. |
| `npx patchwright clear-cache` | Clear the test-runner transform cache. |
| `npx patchwright init-agents` / `init-skills` | Generate agent/skill scaffolding. |
| `npx patchwright-core install-deps` | Install operating-system dependencies (Linux) — **includes Xvfb**. |
| `npx patchwright-core --version` | Prints the current Patchwright version. |

> 🖥️ **System-browser guidance — there is no browser-install step.** Patchwright never
> uses or downloads bundled browsers, so **do not run** any `install` browser command (or
> `npm i playwright-chromium` / `@playwright/browser-chromium`). `chromium.launch()`
> auto-resolves the machine's own browser (Brave → Chrome → Chromium). Target one
> explicitly with `channel: 'brave' | 'brave-beta' | 'chrome' | 'msedge' | 'vivaldi' |
> 'opera' | 'chromium-system'`, `executablePath`, or `PATCHWRIGHT_BINARY` /
> `PATCHWRIGHT_EXECUTABLE_PATH` (managed binaries live in `~/.patchwright/`).

> 🐧 **Xvfb (Linux servers, headed automation).** Headless Chromium needs no display. For
> **headed** runs on a display-less Linux server, use Xvfb — already installed by
> `npx patchwright-core install-deps` on every supported distro:
>
> ```bash
> xvfb-run -a node script.js   # with chromium.launch({ headless: false })
> # or: Xvfb :99 &  DISPLAY=:99 node script.js
> ```
>
> The verification script `utils/test_local_package.sh` already wraps browser runs in
> `xvfb-run` automatically when it is available. On desktops/CI with a real display,
> Xvfb is unnecessary. No Patchwright-side integration is needed.

---

## 🧪 Testing & Verification

### 1. Run Built-In Detection Smoke Test
Run the comprehensive leak detection smoke test:

```bash
node utils/detection_smoke_test.mjs
```
*Verifies `navigator.webdriver = false`, zero Playwright global leaks, and zero `Error.stack` serialization.*
*Uses the auto-resolved system browser (Brave → Chrome → Chromium) — no bundled download needed.*

### 2. Run the New-Features Runtime Smoke Test
Verifies all newly added core patches against the locally built `patchwright-core` (fingerprint spoofing in the main world, WebRTC launch flags, system channels, human input, temp-profile naming):

```bash
node utils/custom_tests/runtime_smoke_test.mjs
# -> 15/15 PASS expected (bundled chromium is used automatically)
```

### 3. Run the TLS/JA4 Alignment Check
Verifies the launched browser's TLS ClientHello fingerprint matches genuine Chrome:

```bash
node utils/custom_tests/tls_ja4_check.mjs
# -> PASS: JA4 matches genuine Chrome profile (t13d1517h2_8daaf6152771_cb7bf5808d99)
```

### 4. Run the Real-World Detector Suite (Real-Browser-MCP)
Live-detector results with system browsers (Brave / Chrome, headless):

```text
The repository's local smoke tests pass. Live third-party detector results depend on the
current detector version, IP reputation, proxy quality and browser build. They are not a
100% undetectability guarantee and are not reproduced here as one.
```

### 5. Run Playwright Core Tests
To verify that Playwright APIs function correctly with the patches:

```bash
bash utils/test_local_package.sh
```

---

## ⚙️ GitHub Actions & OIDC NPM Publishing

This repository includes production-ready GitHub Actions workflows located in [`.github/workflows/`](./.github/workflows/):

* **`patchwright_release.yml`:** The primary automation engine. Checks hourly for upstream Playwright releases, verifies patch impact, runs detection tests, applies AST driver patches, rebrands packages, and publishes both `patchwright-core` and `patchwright` to npm using **OIDC Provenance**.
* **`patchwright_tests.yml`:** Comprehensive Chromium test matrix and bot detection smoke tests.
* **`check_patch_impact.yml`:** Analyzes upstream AST symbols to ensure new Playwright releases do not introduce breaking changes to patched APIs.

### Setting Up OIDC Trusted Publishing on npmjs.com
1. Go to your package settings on [npmjs.com](https://www.npmjs.com/).
2. Under **"Trusted Publishers"**, click **"Add a trusted publisher"** ➔ **GitHub Actions**.
3. Set your GitHub Owner, Repository (`Patchwright`), and Workflow name (`patchwright_release.yml`).
4. GitHub Actions will now publish without requiring static access tokens!

---

## ⚖️ License & Disclaimer

* **License:** Licensed under the [Apache License 2.0](./LICENSE).
* **Disclaimer:** This repository is provided for **educational and research purposes only**. Use at your own risk. The authors assume no liability for any misuse or legal issues resulting from the use of this code.
