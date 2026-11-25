import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ---------------------------
// server/registry/index.ts
// ---------------------------
export function patchSystemBrowser(project: Project) {
	// Add source file to the project
	const registrySourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/registry/index.ts");

	// Locate the last `_createChromiumChannel('msedge-canary', ...)` push in the Registry
	// constructor and append Patchwright's system browser channels right after it. These
	// channels resolve pre-installed browsers on the machine (Brave, Vivaldi, Opera, system
	// Chromium), so `channel: 'brave'` & co. launch the real native binary - no Playwright
	// download, no automation build, real TLS/JA4/GPU fingerprints out of the box.
	const msedgeCanaryPush = assertDefined(
		registrySourceFile
			.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
			.find(
				statement =>
					statement.getExpression().getKind() === SyntaxKind.CallExpression &&
					statement.getText().includes("this._createChromiumChannel('msedge-canary'"),
			),
		"msedge-canary channel registration",
	);

	const registryConstructorBlock = msedgeCanaryPush.getParentIfKindOrThrow(SyntaxKind.Block);
	registryConstructorBlock.insertStatements(
		registryConstructorBlock.getStatements().indexOf(msedgeCanaryPush) + 1,
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
