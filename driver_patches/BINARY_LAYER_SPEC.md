# Patchwright — Patched Binary Layer Specification

> **Status: design document only.** This repository implements the TypeScript/AST driver
> layer. It does not contain, build, or auto-load a patched Chromium binary. The binary
> patch points below are proposals, not shipped features.

> This document specifies the C++ / binary-level patch points that **cannot** be implemented as
> TypeScript AST patches in `driver_patches/`. The TypeScript AST layer (this repository) handles
> the Playwright driver; this binary layer handles the browser itself. The two layers are wired
> together by a loader that is not implemented in this repository (see §5).

## 1. Why a binary layer at all?

The AST patches close every leak that lives in Playwright's driver code (Runtime.enable,
Console.enable, automation switches, init-script injection). A few signals, however, live inside
the Chromium binary and can only be removed there:

| Signal | Why JS cannot fix it |
| :--- | :--- |
| TLS / JA3 / JA4 / HTTP-2 fingerprint | Built by BoringSSL + the network service inside the binary. A JS override never sees the ClientHello. |
| Native `navigator.webdriver` binding | Bound by Blink's C++ layer; `--disable-blink-features=AutomationControlled` covers it, a native patch removes the binding entirely. |
| WebGL / GPU stack identity | The GPU process, ANGLE and SwiftShader fallback decisions are native. |
| CDP endpoint exposure | `DevToolsActivePort`, `--remote-debugging-pipe` socket existence and browser-internal inspection points are OS-level artifacts. |
| Process / profile layout | Where the browser writes its profile, cache and crash dumps is decided in C++. |

## 2. Required C++ patch points

### 2.1 CDP isolation
- **`content/browser/devtools/`** — keep the DevTools http endpoint bound to a named pipe only;
  never write a `DevToolsActivePort` file into the user-data dir.
- **`third_party/blink/renderer/core/inspector/`** — make `Runtime.evaluate` world selection
  indistinguishable from a page-originated evaluation (no `Runtime.enable` side effects at all);
  the driver already avoids `Runtime.enable`, the binary must not re-introduce it.
- **`v8/src/inspector/`** — `Error.prepareStackTrace` / capture paths must not expose the
  inspector's script IDs to page code (brotector's CDP-detection reads these).

### 2.2 AutomationControlled (native)
- **`third_party/blink/renderer/modules/mediastream/`, `frame/`** — remove the
  `navigator.webdriver` IDL binding instead of flag-hiding it, so prototype inspection and
  `in navigator` checks both stay clean.
- **`content/browser/renderer_host/`** — strip the `--enable-automation` behavior switch at
  parse time (defence in depth on top of the driver patch that never sends it).

### 2.3 WebGL / native fingerprint hooks
- **`third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc`** — native
  override point for `UNMASKED_VENDOR_WEBGL` / `UNMASKED_RENDERER_WEBGL` driven by the same
  config source as the JS fallback (§6), so the vendor/renderer string is authentic in the GPU
  process, not just in the renderer.
- **`ui/gl/`** — allow an explicit ANGLE backend selection so the GPU process matches the spoofed
  vendor (SwiftShader fallback produces the `Google Inc. (Google)` signature that detectors flag).
- **`skia/`, `third_party/blink/renderer/platform/graphics/`** — deterministic canvas readback
  hook (equivalent of the JS `canvasNoise`, applied at the raster level, invisible to
  `getImageData`/`toDataURL` stack-inspection).

### 2.4 TLS / JA4 / HTTP-2 alignment
- The realistic goal is **alignment, not spoofing**: launching the machine's own browser
  (`channel: chrome | msedge | brave | vivaldi | opera | chromium-system` via the registry patch)
  yields the genuine Chrome TLS fingerprint for free. The driver patches make this the default
  recommendation.
- If a spoofed fingerprint is genuinely required (e.g. pinned JA4 expectations), the patch lives in
  **`net/socket/ssl_client_socket_impl.cc`** (ClientHello cipher/extension ordering) and
  **`net/http/http_network_session.cc`** (SETTINGS frame ordering). Both are build-time changes;
  they must be validated against the exact BoringSSL revision of the target Chromium.

## 3. Profile / process hygiene (binary side)

- Profile directories created by the binary should use neutral names; the driver already renames
  the Playwright temp prefixes to `pw_<name>_profile-` / `pw-artifacts-`.
- Crash dumps and metrics endpoints (`--metrics-recording-only` etc.) must stay inert in the
  patched build.

## 4. Build integration

1. Fork the Chromium release matching the bundled Playwright Chromium (see
   `packages/playwright-core/browsers.json`).
2. Apply §2 patches; build `chrome` and `chrome-headless-shell` for win32-x64, darwin-arm64,
   darwin-x64 and linux-x64.
3. Name the artifacts `patchwright-chromium[.exe]` / `patchwright-chromium-headless[.exe]` and
   publish them from the Patchwright release workflow (same OIDC-provenance pipeline as the NPM
   driver package).

## 5. Driver ↔ binary contract (driver-side resolution only; no binary shipped)

The driver resolves executables in this order (see `driver_patches/browserTypePatch.ts`):

1. `executablePath` launch option (user-specified; validated as before).
2. `PATCHWRIGHT_BINARY` environment variable.
3. `PATCHWRIGHT_EXECUTABLE_PATH` environment variable (alias).
4. `~/.patchwright/patchwright-chromium[.exe]` — a conventional path the driver checks. No
   Patchwright binary installer or auto-loader ships in this repository.
5. Registry fallback: bundled Chromium or a system channel (`chrome`, `msedge`, `brave`,
   `vivaldi`, `opera`, `chromium-system`, ...).

A patched binary and the driver communicate fingerprint configuration through environment
variables (`PATCHWRIGHT_FINGERPRINT`, `PATCHRIGHT_*` naming is kept stable), so the same config
feeds both the JS fallback (§2.3) and the native hooks (§2.2/2.3). No IPC or protocol changes are
required.

## 6. What stays in the AST layer

Everything else in this repository: launch pipeline, switch sanitisation, WebRTC policy flags,
Runtime/Console leak removal, isolated execution contexts, init-script route injection, human
input simulation, proxy geo alignment and the opt-in JS fingerprint module. The binary layer is not implemented here; the driver remains functional with system browsers
alone.
