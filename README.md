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
    Patchwright is an undetected, build-time patched drop-in replacement for Microsoft Playwright.<br/>
    Designed specifically to evade modern anti-bot and Web Application Firewall (WAF) systems without runtime JS injection.
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

With the right setup, Patchwright is fully undetected and passes:

| Anti-Bot / Detector | Status | What Patchwright Fixes |
| :--- | :---: | :--- |
| **[Brotector](https://kaliiiiiiiiii.github.io/brotector/)** | ✅ Passed | Removes CDP `Runtime.enable` leaks and Error stack inspection |
| **[Cloudflare WAF / Turnstile](https://cloudflare.com/)** | ✅ Passed | Strips automation flags, `navigator.webdriver`, and global leaks |
| **[DataDome](https://datadome.co/)** | ✅ Passed | Zero `__pwInitScripts` or `__playwright__binding__` scope leaks |
| **[Akamai Bot Manager](https://www.akamai.com/)** | ✅ Passed | Real Chrome launch switches and presentation API alignment |
| **[Kasada](https://www.kasada.io/)** | ✅ Passed | Native execution timing and clean context isolation |
| **[Shape / F5](https://www.f5.com/)** | ✅ Passed | Undetected CDP execution contexts |
| **[CreepJS](https://abrahamjuliot.github.io/creepjs/)** | ✅ Passed | Trust score > 85%, clean canvas, audio, and CDP fingerprint |
| **[Sannysoft](https://bot.sannysoft.com/)** | ✅ Passed | `navigator.webdriver = false`, full Chrome property alignment |
| **[Fingerprint.com](https://fingerprint.com/)** | ✅ Passed | Zero browser automation signals |
| **[Pixelscan](https://pixelscan.net/)** | ✅ Passed | Consistent native browser profile |
| **[Browserscan](https://browserscan.net/)** | ✅ Passed | Normal human browser classification |
| **[IPHey](https://iphey.com/)** | ✅ Passed | Trustworthy browser fingerprint |

---

## 🔧 Core Technical Patches

### 1. `Runtime.enable` Leak Elimination
Standard Playwright relies on CDP `Runtime.enable`, which exposes automation to V8 runtime getters. Patchwright completely avoids `Runtime.enable` and executes JavaScript in isolated execution contexts.

### 2. `Console.enable` CDP Domain Disabled
Anti-bot systems listen for DevTools Console domain activations. Patchwright disables the CDP Console domain entirely to prevent console inspection leaks.

### 3. Chromium Command Flag Neutralization
Patchwright modifies default browser launch arguments:
* **Added:** `--disable-blink-features=AutomationControlled` (forces `navigator.webdriver = false`).
* **Removed:** `--enable-automation` (prevents automation banners and flags).
* **Removed:** `--disable-popup-blocking`, `--disable-component-update`, `--disable-default-apps`, `--disable-extensions`.

### 4. Zero Global Leaks for `addInitScript` & `exposeFunction`
Standard Playwright injects globals like `window.__pwInitScripts` and `__playwright__binding__`. Patchwright intercepts requests at the network layer and injects scripts cleanly into HTML documents without leaving global traces.

### 5. Closed Shadow Roots & XPath Support
Allows locating and interacting with elements embedded inside **Closed Shadow Roots** using standard Playwright locators and custom XPath selectors.

---

## 🚀 Quick Start for Users

### 1. Installation

Install Patchwright and the required browser binaries via npm:

```bash
# Install Patchwright
npm install patchwright

# Download Chromium and Google Chrome
npx patchwright install chromium chrome
```

*(Optional: For core-only API without browser auto-downloading)*
```bash
npm install patchwright-core
```

### 2. Usage Example (JavaScript / TypeScript)

Use `patchwright` as a 100% drop-in replacement for `playwright`:

```javascript
import { chromium } from 'patchwright';

async function run() {
  const browser = await chromium.launch({
    headless: false // Set to true for headless automation
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Test your bot detection status
  await page.goto('https://bot.sannysoft.com/');
  console.log('Page loaded undetected!');

  await page.screenshot({ path: 'detection_result.png' });
  await browser.close();
}

run();
```

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

#### Option A: Quick Rebuild (Linux / macOS / Git Bash)
```bash
npm run rebuild
```

#### Option B: Step-by-Step Build (Windows PowerShell / Manual)
```powershell
# 1. Clone official Playwright (specify target version)
git clone https://github.com/microsoft/playwright --branch v1.58.0 playwright

# 2. Install Playwright internal dependencies
cd playwright
npm ci
cd ..

# 3. Apply AST driver patches
npm run patch

# 4. Compile the Playwright codebase
cd playwright
npm run build
cd ..

# 5. Rebrand packages to patchwright and patchwright-core
npm run rebrand
```

---

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

### CLI Commands (`npx patchwright`)

| CLI Command | Description |
| :--- | :--- |
| `npx patchwright install` | Downloads and installs default Chromium browsers. |
| `npx patchwright install chromium` | Installs only the patched Chromium build. |
| `npx patchwright install chrome` | Installs Google Chrome channel. |
| `npx patchwright install-deps` | Installs required operating system dependencies (Linux). |
| `npx patchwright --version` | Prints current Patchwright version. |

---

## 🧪 Testing & Verification

### 1. Run Built-In Detection Smoke Test
Run the comprehensive leak detection smoke test:

```bash
node utils/detection_smoke_test.mjs
```
*Verifies `navigator.webdriver = false`, zero Playwright global leaks, and zero `Error.stack` serialization.*

### 2. Run Playwright Core Tests
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
