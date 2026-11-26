import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ---------------------------
// server/registry/index.ts
// ---------------------------
export function patchSystemBrowser(project: Project) {
	// Add source file to the project
	const registrySourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/registry/index.ts");
	const registryClass = registrySourceFile.getClassOrThrow("Registry");

	// Patchwright drops Microsoft Edge support entirely: Edge sessions are rejected
	// by anti-bot managed-challenge scoring and are never branded or spoofed, so
	// the msedge / msedge-beta / msedge-dev / msedge-canary registry channels are
	// removed. `channel: 'msedge*'` fails with Patchwright's own clear error.
	const msedgeChannelPushes = registrySourceFile
		.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
		.filter(
			statement =>
				statement.getExpression().getKind() === SyntaxKind.CallExpression &&
				statement.getText().includes("this._createChromiumChannel('msedge"),
		);
	if (msedgeChannelPushes.length === 0) throw new Error("msedge channel registrations not found");
	for (const push of msedgeChannelPushes) push.remove();

	// The Edge install helper becomes unreachable once its channels are gone.
	registryClass.getMethod("_installMSEdgeChannel")?.remove();

	// 'msedge' is no longer a best-effort Selenium/trace-viewer channel candidate.
	const bestEffortStatement = assertDefined(
		registrySourceFile
			.getDescendantsOfKind(SyntaxKind.ForOfStatement)
			.find(statement => statement.getText().includes("['chromium', 'chrome', 'msedge']")),
		"findChromiumChannelBestEffort channel list",
	);
	bestEffortStatement.replaceWithText(
		bestEffortStatement.getText().replace("['chromium', 'chrome', 'msedge']", "['chromium', 'chrome']"),
	);

	// Locate the last `_createChromiumChannel('chrome-canary', ...)` push in the Registry
	// constructor and append Patchwright's system browser channels right after it. These
	// channels resolve pre-installed browsers on the machine (Brave, Vivaldi, Opera, system
	// Chromium), so `channel: 'brave'` & co. launch the real native binary - no Playwright
	// download, no automation build, real TLS/JA4/GPU fingerprints out of the box.
	const chromeCanaryPush = assertDefined(
		registrySourceFile
			.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
			.find(
				statement =>
					statement.getExpression().getKind() === SyntaxKind.CallExpression &&
					statement.getText().includes("this._createChromiumChannel('chrome-canary'"),
			),
		"chrome-canary channel registration",
	);

	const registryConstructorBlock = chromeCanaryPush.getParentIfKindOrThrow(SyntaxKind.Block);
	registryConstructorBlock.insertStatements(
		registryConstructorBlock.getStatements().indexOf(chromeCanaryPush) + 1,
		`
		// Patchwright: pre-installed system browser channels. Launching the machine's own
		// browser keeps native signals (TLS/JA4, HTTP/2 settings, GPU stack, DLL layout)
		// perfectly authentic while the patched driver hides the automation layer.
		this._executables.push(this._createChromiumChannel('brave', {
			'linux': '/opt/brave.com/brave/brave-browser',
			'darwin': '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
			'win32': \`\\\\BraveSoftware\\\\Brave-Browser\\\\Application\\\\brave.exe\`,
		}));
		this._executables.push(this._createChromiumChannel('brave-beta', {
			'linux': '/opt/brave.com/brave-beta/brave-browser',
			'darwin': '/Applications/Brave Browser Beta.app/Contents/MacOS/Brave Browser Beta',
			'win32': \`\\\\BraveSoftware\\\\Brave-Browser-Beta\\\\Application\\\\brave.exe\`,
		}));
		this._executables.push(this._createChromiumChannel('vivaldi', {
			'linux': '/opt/vivaldi/vivaldi',
			'darwin': '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
			'win32': \`\\\\Vivaldi\\\\Application\\\\vivaldi.exe\`,
		}));
		this._executables.push(this._createChromiumChannel('opera', {
			'linux': '/opt/opera/opera',
			'darwin': '/Applications/Opera.app/Contents/MacOS/Opera',
			'win32': \`\\\\Programs\\\\Opera\\\\opera.exe\`,
		}));
		this._executables.push(this._createChromiumChannel('chromium-system', {
			'linux': '/usr/bin/chromium',
			'darwin': '/Applications/Chromium.app/Contents/MacOS/Chromium',
			'win32': \`\\\\Chromium\\\\Application\\\\chrome.exe\`,
		}));
	`,
	);
}
