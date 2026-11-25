import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined, replaceRequired } from "./utils.ts";

// ------------------------
// server/browserType.ts
// ------------------------
export function patchBrowserType(project: Project) {
	// Add source file to the project
	const browserTypeSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/browserType.ts");

	// -- Neutral temporary profile / artifacts naming --
	// Temporary profiles named "playwright_...dev_profile-" and "playwright-artifacts-" can
	// leak the automation stack (e.g. when a download reveals its origin path). Use neutral,
	// Playwright-free prefixes instead.
	{
		let sourceText = browserTypeSourceFile.getFullText();
		sourceText = replaceRequired(
			sourceText,
			"'playwright-artifacts-'",
			"'pw-artifacts-'",
			"browserType.ts artifacts prefix",
		);
		sourceText = replaceRequired(
			sourceText,
			"`playwright_${this._name}dev_profile-`",
			"`pw_${this._name}_profile-`",
			"browserType.ts temp profile prefix",
		);
		browserTypeSourceFile.replaceWithText(sourceText);
	}

	// -- executablePath() API: never point at the bundled Chrome-for-Testing registry --
	const browserTypeClass = browserTypeSourceFile.getClassOrThrow("BrowserType");
	const executablePathMethod = browserTypeClass.getMethodOrThrow("executablePath");
	executablePathMethod.setBodyText(`
		// Patchwright: resolve an official system browser instead of the bundled
		// Chrome-for-Testing registry binary.
		for (const candidate of patchwrightSystemBrowserCandidates()) {
			if (fs.existsSync(candidate))
				return candidate;
		}
		return '';
	`);

	// -- resolveExecutablePath: managed binary / official system browser auto-load; NEVER bundled Chrome-for-Testing --
	const resolveExecutablePathMethod = browserTypeClass.getMethodOrThrow("resolveExecutablePath");
	resolveExecutablePathMethod.setBodyText(`
		const { executablePath } = options;
		if (executablePath) {
			if (!(await existsAsync(executablePath)))
				throw new Error(\`Failed to launch \${this._name} because executable doesn't exist at \${executablePath}\`);
			return executablePath;
		}
		// Patchwright: auto-load a managed (patched) browser binary first.
		// PATCHWRIGHT_BINARY / PATCHWRIGHT_EXECUTABLE_PATH point at a patched build or a
		// system browser; the conventional ~/.patchwright location is checked automatically.
		for (const candidate of [process.env.PATCHWRIGHT_BINARY, process.env.PATCHWRIGHT_EXECUTABLE_PATH, patchwrightDefaultBinaryPath()]) {
			if (candidate && await existsAsync(candidate))
				return candidate;
		}
		if (this._name === 'chromium') {
			// Official channel options (chrome, msedge, brave, ...) resolve through the
			// registry, which locates the system-installed browser (no download involved).
			if (options.channel && options.channel !== 'chromium')
				return undefined;
			// Patchwright: never fall back to the bundled Chrome-for-Testing registry.
			// Resolve an official system browser in native-identity-safe order
			// (Google Chrome -> Chromium -> Brave) across Windows / Linux / macOS;
			// the scanned paths match whatever architecture (x64 / x86 / arm64)
			// is installed on this machine. Brave is deliberately last: its native
			// farbling and navigator.brave artifact cannot be made to look like
			// Google Chrome without a contradiction.
			for (const candidate of patchwrightSystemBrowserCandidates()) {
				if (await existsAsync(candidate))
					return candidate;
			}
			throw new Error('Patchwright: no official system browser found (Google Chrome, Chromium or Brave). Install one of these browsers, or point PATCHWRIGHT_BINARY at a browser executable.');
		}
		return undefined;
	`);

	// -- prepareUserDataDir call site: seed Brave shields prefs into fresh temp profiles --
	const prepareToLaunchMethod = browserTypeClass.getMethodOrThrow("_prepareToLaunch");
	const resolveCallStatement = assertDefined(
		prepareToLaunchMethod
			.getDescendantsOfKind(SyntaxKind.VariableStatement)
			.find(statement => statement.getText().includes("await this.resolveExecutablePath(options)")),
		"resolveExecutablePath call in _prepareToLaunch",
	);
	const resolveCallBlock = resolveCallStatement.getParentIfKindOrThrow(SyntaxKind.Block);
	resolveCallBlock.insertStatements(
		resolveCallBlock.getStatements().indexOf(resolveCallStatement) + 1,
		`
			// Patchwright: keep the resolved path on the launch options so
			// BrowserOptions and every stealth check see the same executable.
			if (customExecutablePath)
				(options as any).customExecutablePath = customExecutablePath;
		`,
	);
	const prepareUserDataDirStatement = assertDefined(
		prepareToLaunchMethod
			.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
			.find(statement => statement.getText().includes("this.prepareUserDataDir(options, userDataDir)")),
		"prepareUserDataDir call in _prepareToLaunch",
	);
	const prepareBlock = prepareUserDataDirStatement.getParentIfKindOrThrow(SyntaxKind.Block);
	prepareBlock.insertStatements(
		prepareBlock.getStatements().indexOf(prepareUserDataDirStatement) + 1,
		`
			// Patchwright: Brave seeds shields fingerprinting farbling on every fresh temp
			// profile, which breaks canvas/audio exactness and randomizes
			// hardwareConcurrency/deviceMemory (detected as noise/masking by fingerprint
			// checkers like pixelscan's C14). Seed the profile's Preferences with
			// fingerprinting + HTTPS-upgrade shields disabled (Brave shields v2
			// content-settings format) before the browser process starts. Opt out with
			// PATCHWRIGHT_BRAVE_FARBLING=0.
			if (process.env.PATCHWRIGHT_BRAVE_FARBLING !== '0') {
				try {
					const braveEngine = (options.channel || '').startsWith('brave') || /brave/i.test(options.executablePath || options.customExecutablePath || '');
					if (braveEngine) {
						const fsPw = require('fs');
						const pathPw = require('path');
						const lastModified = String(Date.now() * 1000 + 11644473600000000);
						const defaultDir = pathPw.join(userDataDir, 'Default');
						fsPw.mkdirSync(defaultDir, { recursive: true });
						const prefsPath = pathPw.join(defaultDir, 'Preferences');
						let prefsPw = {};
						try { prefsPw = JSON.parse(fsPw.readFileSync(prefsPath, 'utf8')); } catch { }
						prefsPw.profile = prefsPw.profile || {};
						prefsPw.profile.content_settings = prefsPw.profile.content_settings || {};
						prefsPw.profile.content_settings.exceptions = prefsPw.profile.content_settings.exceptions || {};
						const exceptionsPw = prefsPw.profile.content_settings.exceptions;
						const globalPattern = 'https://*,*';
						const pwEntry = (setting: number) => ({ setting, last_modified: lastModified });
						exceptionsPw.fingerprintingV2 = { [globalPattern]: pwEntry(1) }; // 1 = disabled
						exceptionsPw.httpsUpgrades = { [globalPattern]: pwEntry(1) }; // disabled
						fsPw.writeFileSync(prefsPath, JSON.stringify(prefsPw));
					}
				} catch { }
			}
		`,
	);

	// -- module-level helpers --
	browserTypeSourceFile.addStatements(`
		// Patchwright: conventional location for a managed (patched) browser binary.
		function patchwrightDefaultBinaryPath(): string {
			const binaryName = process.platform === 'win32' ? 'patchwright-chromium.exe' : 'patchwright-chromium';
			return path.join(os.homedir(), '.patchwright', binaryName);
		}

		// Patchwright: official system browser candidates in priority order
		// (Chrome -> Chromium -> Brave) for Windows, Linux and macOS. Microsoft Edge is
			// intentionally excluded from auto-discovery: Cloudflare's managed-challenge
			// scoring rejects Edge sessions (headless or not), making WAF tests unpassable.
			// Users can still request Edge explicitly via channel: 'msedge' or executablePath.
		// The paths are arch-agnostic: whatever binary is installed on the machine
		// (x64, x86 or arm64) is the one that gets launched.
		function patchwrightSystemBrowserCandidates(): string[] {
			const candidates: string[] = [];
			if (process.platform === 'win32') {
				const pf = process.env['ProgramFiles'] || 'C:\\\\Program Files';
				const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\\\Program Files (x86)';
				const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
				candidates.push(
					path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
					path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
					path.join(lad, 'Google', 'Chrome', 'Application', 'chrome.exe'),
					path.join(pf, 'Chromium', 'Application', 'chrome.exe'),
					path.join(lad, 'Chromium', 'Application', 'chrome.exe'),
					path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
					path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
					path.join(lad, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
				);
			} else if (process.platform === 'darwin') {
				candidates.push(
					'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
					'/Applications/Chromium.app/Contents/MacOS/Chromium',
					'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
				);
			} else {
				candidates.push(
					'/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/opt/google/chrome/chrome',
					'/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/chrome', '/snap/bin/chromium',
					'/usr/bin/brave-browser', '/usr/bin/brave', '/opt/brave.com/brave/brave',
				);
			}
			return candidates;
		}

		// Patchwright: verify a downloaded macOS app bundle before copying it.
		// Never copy an unsigned or Gatekeeper-rejected browser into /Applications.
		async function patchwrightVerifyMacApp(appPath: string): Promise<boolean> {
			const codesign = await patchwrightRunCommand('codesign', ['--verify', '--deep', '--strict', appPath], 30000);
			if (!codesign.ok)
				return false;
			const gatekeeper = await patchwrightRunCommand('spctl', ['--assess', '--type', 'execute', '--verbose', appPath], 30000);
			return gatekeeper.ok;
		}
	`);

	// Propagate the auto-resolved executable into BrowserOptions. This textual
	// edit runs last because replaceWithText invalidates earlier class nodes.
	let finalText = browserTypeSourceFile.getFullText();
	finalText = replaceRequired(
		finalText,
		"customExecutablePath: options.executablePath,",
		"customExecutablePath: options.executablePath || (options as any).customExecutablePath,",
		"browserType.ts customExecutablePath propagation",
	);
	browserTypeSourceFile.replaceWithText(finalText);
}
