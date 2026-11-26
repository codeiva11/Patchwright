import fs from "node:fs/promises";
import { IndentationText, Project } from "ts-morph";
import YAML from "yaml";

import * as patches from "./driver_patches/index.ts";
import * as clientPatches from "./patchwright-nodejs/index.ts";
import { formatFiles } from "./utils/format-indentation.ts";

// Patchwright: self-healing patch pipeline. The patches are only idempotent against a
// vanilla Playwright tree (they fail loudly when their already-patched text is missing),
// so reset the patched trees before applying. Set PATCHWRIGHT_KEEP_WORKTREE=1 to skip
// (e.g. when iterating on a single patch against a partially patched tree).
import { execFileSync } from "node:child_process";
if (process.env.PATCHWRIGHT_KEEP_WORKTREE !== "1") {
	try {
		// The script is always run from the playwright/ checkout, so resolve its
		// git toplevel instead of assuming a repository-relative path.
		const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "pipe"] })
			.toString()
			.trim();
		execFileSync("git", ["-C", toplevel, "checkout", "HEAD", "--", "packages/", "utils/"], { stdio: "pipe" });
		execFileSync("git", ["-C", toplevel, "clean", "-fdx", "-e", "node_modules"], { stdio: "pipe" });
		console.log("[patchwright_driver_patch] reset playwright/ to vanilla (packages/ + utils/).");
	} catch (error) {
		console.log(
			"[patchwright_driver_patch] worktree reset skipped (not a git checkout?):",
			String(error).split("\n")[0],
		);
	}
}

const project = new Project({
	manipulationSettings: {
		indentationText: IndentationText.TwoSpaces,
	},
});

// ------------------------
// client/browserContext.ts
// ------------------------
clientPatches.patchBrowserContext(project);

// ----------------------
// client/clientHelper.ts
// ----------------------
clientPatches.patchClientHelper(project);

// ---------------
// client/clock.ts
// ---------------
clientPatches.patchClock(project);

// ---------------
// client/frame.ts
// ---------------
clientPatches.patchFrame(project);

// ------------------
// client/jsHandle.ts
// ------------------
clientPatches.patchJsHandle(project);

// -----------------
// client/locator.ts
// -----------------
clientPatches.patchLocator(project);

// -----------------
// client/network.ts
// -----------------
clientPatches.patchNetwork(project);

// --------------
// client/page.ts
// --------------
clientPatches.patchPage(project);

// ----------------------
// client/tracing.ts
// ----------------------
clientPatches.patchTracing(project);

// ----------------
// client/worker.ts
// ----------------
clientPatches.patchWorker(project);

// ----------------
// client/input.ts
// (human-like mouse/keyboard/scroll)
// ----------------
clientPatches.patchHumanInput(project);

// ------------------------------------
// client/browserType.ts + browser.ts
// (proxy timezone/geo/language alignment)
// ------------------------------------
clientPatches.patchGeoAlign(project);

// ------------------------
// server/browserContext.ts
// ------------------------
patches.patchBrowserContext(project);

// --------------------
// utils/build/build.js
// --------------------
patches.patchBuild(project);

// ---------------------------
// server/chromium/chromium.ts
// ---------------------------
patches.patchChromium(project);

// ----------------------------------
// server/chromium/launch pipeline
// (WebRTC leak protection flags)
// ----------------------------------
patches.patchChromiumLaunch(project);
patches.patchLaunchUserAgent(project);

// ----------------------------------
// server/registry/index.ts
// (system browser channels)
// ----------------------------------
patches.patchSystemBrowser(project);

// ------------------------
// server/browserType.ts
// (patched binary auto-load +
// neutral temp profile naming)
// ------------------------
patches.patchBrowserType(project);

// -----------------------------------
// server/browserType.ts
// (automatic system-browser installation
// when no official browser is installed)
// -----------------------------------
patches.patchAutoInstall(project);

// -----------------------------------
// server/browserType.ts
// (auto Xvfb display for headful
// launches on display-less Linux)
// -----------------------------------
patches.patchXvfb(project);

// -----------------------------------
// server/chromium/chromiumSwitches.ts
// -----------------------------------
patches.patchChromiumSwitches(project);

// ----------------------------
// server/chromium/crBrowser.ts
// ----------------------------
patches.patchCRBrowser(project);

// -----------------------------
// server/chromium/crDevTools.ts
// -----------------------------
patches.patchCRDevTools(project);

// ------------------------------------
// server/chromium/crExecutionContext.ts
// ------------------------------------
patches.patchCRExecutionContext(project);

// -----------------------------------
// server/chromium/crNetworkManager.ts
// -----------------------------------
patches.patchCRNetworkManager(project);

// -----------------------------
// server/chromium/crCoverage.ts
// -----------------------------
patches.patchCRCoverage(project);

// ----------------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------------
patches.patchCRServiceWorker(project);

// ---------------------
// server/credentials.ts
// ---------------------
patches.patchCredentials(project);

// ----------------
// server/frames.ts
// ----------------
patches.patchFrames(project);

// -------------------------
// server/frameSelectors.ts
// -------------------------
patches.patchFrameSelectors(project);

// -------------------------
// server/chromium/crPage.ts
// -------------------------
patches.patchCRPage(project);

// --------------
// server/page.ts
// --------------
patches.patchPage(project);

// ---------------------------------------------
// utils/isomorphic/utilityScriptSerializers.ts
// --------------------------------------------
patches.patchUtilityScriptSerializers(project);

// -----------------------------
// injected/src/utilityScript.ts
// -----------------------------
patches.patchUtilityScript(project);

// ---------------------
// server/pageBinding.ts
// ---------------------
patches.patchPageBinding(project);

// ---------------
// server/clock.ts
// --------------
patches.patchClock(project);

// ------------------------------------
// server/browserContext.ts
// (fingerprint spoofing + permissions)
// ------------------------------------
patches.patchFingerprint(project);
patches.patchFingerprintHardening(project);
// ----------------------------------
// server/chromium/crPage.ts
// (system-browser stealth: UA brands +
// HeadlessChrome token fix)
// ----------------------------------
patches.patchSystemStealth(project);
// ------------------------------------------
// lazy Runtime.enable for console/pageerror
// ------------------------------------------
patches.patchLazyConsole(project);
patches.patchViewportSurface(project);

// ----------------------
// Patchwright CLI Aliases
// ----------------------
patches.patchCliAlias(project);

// --------------------
// server/javascript.ts
// --------------------
patches.patchJavascript(project);

// -------------------
// server/launchApp.ts
// -------------------
patches.patchLaunchApp(project);

// -------------------------------------
// server/dispatchers/frameDispatcher.ts
// -------------------------------------
patches.patchFrameDispatcher(project);

// ----------------------------------------------
// server/dispatchers/browserContextDispatcher.ts
// ----------------------------------------------
patches.patchBrowserContextDispatcher(project);

// -----------------
// server/network.ts
// -----------------
patches.patchNetwork(project);

// ---------------------------------------------
// server/dispatchers/networkDispatchers.ts
// ---------------------------------------------
patches.patchNetworkDispatchers(project);

// ----------------------------------------
// server/dispatchers/jsHandleDispatcher.ts
// ----------------------------------------
patches.patchJSHandleDispatcher(project);

// ------------------------------------
// server/dispatchers/pageDispatcher.ts
// ------------------------------------
patches.patchPageDispatcher(project);

// -----------------------------------
// injected/src/xpathSelectorEngine.ts
// -----------------------------------
patches.patchXPathSelectorEngine(project);

// -------------------------
// recorder/src/recorder.tsx
// -------------------------
patches.patchRecorder(project);

// -----------------------
// server/screenshotter.ts
// -----------------------
patches.patchScreenshotter(project);

// ------------------------------------
// server/trace/recorder/snapshotter.ts
// ------------------------------------
patches.patchSnapshotter(project);

// --------------------------------------------
// server/trace/recorder/snapshotterInjected.ts
// --------------------------------------------
patches.patchSnapshotterInjected(project);

// --------------------------------
// server/trace/recorder/tracing.ts
// --------------------------------
patches.patchTracing(project);

// ----------------------
// protocol/spec/*.yml
// ----------------------
async function mutateYaml(path: string, callback: (document: any) => void) {
	const document = YAML.parse(await fs.readFile(path, "utf8"));
	callback(document);
	await fs.writeFile(path, YAML.stringify(document));
}

await mutateYaml("packages/protocol/spec/frame.yml", protocol => {
	protocol.Frame.commands.evaluateExpression.parameters.isolatedContext = "boolean?";
	protocol.Frame.commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
	protocol.Frame.commands.evalOnSelectorAll.parameters.isolatedContext = "boolean?";
});
await mutateYaml("packages/protocol/spec/handles.yml", protocol => {
	protocol.JSHandle.commands.evaluateExpression.parameters.isolatedContext = "boolean?";
	protocol.JSHandle.commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
});
await mutateYaml("packages/protocol/spec/worker.yml", protocol => {
	protocol.Worker.commands.evaluateExpression.parameters.isolatedContext = "boolean?";
	protocol.Worker.commands.evaluateExpressionHandle.parameters.isolatedContext = "boolean?";
});
await mutateYaml("packages/protocol/spec/mixins.yml", protocol => {
	protocol.ContextOptions.properties.focusControl = "boolean?";
});
await mutateYaml("packages/protocol/spec/network.yml", protocol => {
	protocol.Route.commands.continue.parameters.patchwrightInitScript = "boolean?";
});

// --------------------------------
// Post-patch sanity verification
// --------------------------------
// Textual patch targets are verified at application time (see driver_patches/utils.ts);
// this final sweep asserts the core guarantees directly on the patched sources, so that an
// updated upstream cannot silently drop them.
const sanityChecks: Array<{ file: string; require?: string[]; forbid?: string[] }> = [
	{
		file: "packages/playwright-core/src/server/browserType.ts",
		require: ["pw-artifacts-", "pw_${this._name}_profile-"],
		forbid: ["playwright-artifacts-", "playwright_${this._name}dev_profile-"],
	},
	{
		file: "packages/playwright-core/src/cli/program.ts",
		require: ["Patchwright"],
		forbid: ["Playwright version:", "all playwright installations"],
	},
	{
		file: "packages/playwright-core/src/cli/installActions.ts",
		forbid: ["Playwright version:", "npx playwright install", "Playwright Host validation"],
	},
];
for (const sanityCheck of sanityChecks) {
	const sourceFile =
		project.getSourceFile(sourceFile => sourceFile.getFilePath().replace(/\\/g, "/").endsWith(sanityCheck.file)) ??
		project.addSourceFileAtPath(sanityCheck.file);
	const text = sourceFile.getFullText();
	for (const required of sanityCheck.require ?? [])
		if (!text.includes(required))
			throw new Error(`Post-patch verification failed: ${sanityCheck.file} must contain ${JSON.stringify(required)}`);
	for (const forbidden of sanityCheck.forbid ?? [])
		if (text.includes(forbidden))
			throw new Error(
				`Post-patch verification failed: ${sanityCheck.file} must not contain ${JSON.stringify(forbidden)}`,
			);
}

// Save and format all patched TypeScript sources before they are built.
await project.save();
await formatFiles(
	project.getSourceFiles().map(sourceFile => sourceFile.getFilePath()),
	{
		arrowParens: "avoid",
		printWidth: 120,
		singleQuote: true,
		tabWidth: 2,
		useTabs: false,
	},
);
