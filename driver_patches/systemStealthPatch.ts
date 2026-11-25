import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// -------------------------
// server/chromium/crPage.ts
// -------------------------
export function patchSystemStealth(project: Project) {
	// Add source file to the project
	const crPageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crPage.ts");

	// ------- FrameSession Class -------
	const frameSessionClass = crPageSourceFile.getClassOrThrow("FrameSession");

	// -- _applySystemStealthOverride Method --
	// When a system browser (Brave/Edge/Chrome/Chromium/...) is launched through the
	// Patchwright driver, two native signals are inconsistent with the UA string and
	// trip bot detectors:
	//   1. Brave keeps the HeadlessChrome token even with --headless=new.
	//   2. Brave/Edge/Chromium/Vivaldi/Opera report client-hint brand lists without
	//      "Google Chrome" (rebrowser's useragent check flags exactly this as
	//      Chrome-for-Testing), while their UA strings already claim Chrome.
	// Fix both with a single native Network.setUserAgentOverride (feeds navigator
	// .userAgentData AND the Sec-CH-UA* headers), so JS and headers stay consistent.
	frameSessionClass.addMethod({
		name: "_applySystemStealthOverride",
		isAsync: true,
	});
	const stealthMethod = frameSessionClass.getMethodOrThrow("_applySystemStealthOverride");
	// -- _initializeWorker Method: navigator.brave deletion in worker realms --
	// Brave exposes navigator.brave inside dedicated workers too, and context/page
	// init scripts do not run in worker realms. A detector can fingerprint Brave
	// by checking navigator.brave inside a worker, so delete it there as well.
	// The worker session is created with waitForDebuggerOnStart, so the deletion
	// runs before the worker's own scripts execute.
	const initializeWorkerMethod = frameSessionClass.getMethodOrThrow("_initializeWorker");
	const workerSessionsSet = assertDefined(
		initializeWorkerMethod
			.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
			.find(statement => statement.getText().includes("this._workerSessions.set(event.sessionId, session);")),
		"worker sessions map assignment",
	);
	const workerSessionsBlock = workerSessionsSet.getParentIfKindOrThrow(SyntaxKind.Block);
	workerSessionsBlock.insertStatements(
		workerSessionsBlock.getStatements().indexOf(workerSessionsSet) + 1,
		`
		const braveWorkerOptions = this._crPage._browserContext._browser.options;
		if (/brave/i.test(braveWorkerOptions.customExecutablePath || '') || (braveWorkerOptions.channel || '').startsWith('brave')) {
			session._sendMayFail('Runtime.evaluate', {
				expression: '(function(){ try { Reflect.deleteProperty(navigator, "brave"); } catch (e) { } try { var pwProto = Object.getPrototypeOf(navigator); if (pwProto) Reflect.deleteProperty(pwProto, "brave"); } catch (e) { } try { if (typeof Navigator !== "undefined") Reflect.deleteProperty(Navigator.prototype, "brave"); } catch (e) { } })();',
			});
		}
	`,
	);
	stealthMethod.setBodyText(`
		try {
			if (process.env.PATCHWRIGHT_SYSTEM_STEALTH === '0')
				return;
			const browserOptions = this._crPage._browserContext._browser.options;
			const chromiumAliases = ['chromium', 'chromium-headless-shell'];
			const isSystemBrowser = (!!browserOptions.channel && !chromiumAliases.includes(browserOptions.channel)) || !!browserOptions.customExecutablePath;
			if (!isSystemBrowser)
				return;
			const snapshot = await this._client.send('Runtime.evaluate', {
				expression: \`(async () => {
					const hev = navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['brands', 'fullVersionList', 'platform', 'platformVersion', 'architecture', 'bitness', 'model', 'mobile', 'wow64']).catch(() => null) : null;
					return JSON.stringify({ ua: navigator.userAgent, brave: !!navigator.brave, hev });
				})()\`,
				returnByValue: true,
				awaitPromise: true,
			});
			if (!snapshot?.result?.value)
				return;
			const native = JSON.parse(snapshot.result.value);
			if (!native?.ua)
				return;
			let userAgent: string = native.ua;
			// Brave keeps the HeadlessChrome token even with --headless=new; real Chrome does not.
			if (!browserOptions.headful && userAgent.includes('HeadlessChrome'))
				userAgent = userAgent.replace('HeadlessChrome', 'Chrome');
			const nativeBrands: Array<{ brand: string; version: string }> = native.hev?.brands || [];
			const nativeFullVersionList: Array<{ brand: string; version: string }> = native.hev?.fullVersionList || [];
			const hasGoogleChrome = (list: Array<{ brand: string; version: string }>) => list.some(entry => entry.brand === 'Google Chrome');
			const major = (userAgent.match(/Chrome\\/(\\d+)/) || userAgent.match(/Chromium\\/(\\d+)/) || [])[1];
			if (!major)
				return;
			// Read the browser's real full version straight from the binary (--version works
			// on every Chromium-family build). This keeps the claimed Client-Hints dynamic:
			// Brave 158.1.x claims 158.1.x, Chrome 158.0.8127.89 claims exactly that, instead
			// of a sanitized major.0.0.0 that detector databases can flag as masked.
			let realFullVersion = '';
			try {
				const exe = browserOptions.executablePath || browserOptions.customExecutablePath;
				if (exe) {
					// Cached per executable: spawning --version on every context adds
					// latency for multi-context runs. The binary cannot change while the
					// driver process is alive, so a process-lifetime cache is safe.
					realFullVersion = patchwrightCachedRealFullVersion(exe);
				}
			} catch { }
			const nativeChromiumFull = (nativeFullVersionList.find(entry => entry.brand === 'Chromium') || {}).version || '';
			const fullVersion = realFullVersion || nativeChromiumFull || (userAgent.match(/(?:Chrome|Chromium)\\/([\\d.]+)/) || [])[1] || major + '.0.0.0';
			if (hasGoogleChrome(nativeBrands)) {
				// Real Google Chrome: UA and Client-Hints are already authentic. Only fix the
				// headless token (a UA-only override keeps the native metadata intact). The UA
				// stays in Chrome's authentic reduced format — a full-version UA token is what
				// Cloudflare WAF scores as suspicious.
				if (userAgent !== native.ua)
					await this._client.send('Network.setUserAgentOverride', { userAgent });
				if (chromeTokenFix !== native.ua)
					await this._client.send('Network.setUserAgentOverride', { userAgent: chromeTokenFix });
				return;
			}
			const channel: string = browserOptions.channel || '';
			// Brave engine detection: either the brave channel or a brave binary path.
			const isBraveEngine = channel.startsWith('brave') || /brave/i.test(browserOptions.customExecutablePath || '');
			let brands: Array<{ brand: string; version: string }>;
			let fullVersionList: Array<{ brand: string; version: string }>;
			if (channel.startsWith('msedge')) {
				// Edge's UA legitimately carries both the Chrome and Edg tokens; keep the
				// native Edge branding (with its real full versions) and only add the Google
				// Chrome entry the UA implies.
				brands = [...nativeBrands, { brand: 'Google Chrome', version: major }];
				fullVersionList = [...nativeFullVersionList, { brand: 'Google Chrome', version: fullVersion }];
			} else {
				// Brave/Vivaldi/Opera/Chromium: the UA string claims plain Chrome, so mirror a
				// genuine Chrome brand list (grease rotation included, like real Chrome) with
				// the browser's real full version.
				const grease = ['Not/A)Brand', 'Not A;Brand', 'Not?A_Brand'][Number(major) % 3];
				const nativeGreaseFull = (nativeFullVersionList.find(entry => /Not/i.test(entry.brand)) || {}).version || '24.0.0.0';
				// Normalize the UA token to Chrome's authentic reduced UA (Chrome/<major>.0.0.0)
				// (covers Brave's Chrome token, Chromium's Chromium token and HeadlessChrome).
				userAgent = userAgent.replace(/(HeadlessChrome|Chromium|Chrome)\\/[\\d.]+/, 'Chrome/' + major + '.0.0.0');
				brands = [
					{ brand: grease, version: '24' },
					{ brand: 'Chromium', version: major },
					{ brand: 'Google Chrome', version: major },
				];
				fullVersionList = [
					{ brand: grease, version: nativeGreaseFull },
					{ brand: 'Chromium', version: fullVersion },
					{ brand: 'Google Chrome', version: fullVersion },
				];
			}
			await this._client.send('Network.setUserAgentOverride', {
				userAgent,
				userAgentMetadata: {
					brands,
					fullVersionList,
					fullVersion,
					platform: native.hev?.platform || 'Windows',
					platformVersion: native.hev?.platformVersion || '',
					architecture: native.hev?.architecture || 'x86',
					model: native.hev?.model || '',
					bitness: native.hev?.bitness || '64',
					mobile: !!native.hev?.mobile,
					wow64: !!native.hev?.wow64,
				},
			});
			// UAParser-based detectors (e.g. pixelscan) identify the browser as "Brave"
			// through navigator.brave.isBrave, which then contradicts the aligned Chrome
			// brand list. Shadow the artifact for every document of this context.
			if (isBraveEngine) {
				const artifactScript = '(function(){ try { Reflect.deleteProperty(navigator, "brave"); } catch (e) { } try { var pwProto = Object.getPrototypeOf(navigator); if (pwProto) Reflect.deleteProperty(pwProto, "brave"); } catch (e) { } try { if (typeof Navigator !== "undefined") Reflect.deleteProperty(Navigator.prototype, "brave"); } catch (e) { } })();';
				const context = this._crPage._browserContext as any;
				if (!context._patchwrightBraveStealthApplied) {
					context._patchwrightBraveStealthApplied = true;
					await context.addInitScript(nullProgress, artifactScript);
				}
				const page = this._crPage._page as any;
				if (!page._patchwrightBraveStealthApplied) {
					page._patchwrightBraveStealthApplied = true;
					await this._crPage._page.addInitScript(nullProgress, artifactScript);
				}
			}
		} catch (e) {
			// The stealth override is best-effort; never break the launch.
		}
	`);

	// -- hook the override into the main-frame session initialization --
	const initializeBlockStatement = assertDefined(
		frameSessionClass
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find(
				ifStatement =>
					ifStatement.getExpression().getText().includes("options.userAgent || options.locale") &&
					ifStatement.getText().includes("promises.push(this._updateUserAgent())"),
			),
		"main frame _updateUserAgent if-statement",
	);
	const initializeBlock = initializeBlockStatement.getParentIfKindOrThrow(SyntaxKind.Block);
	initializeBlock.insertStatements(
		initializeBlock.getStatements().indexOf(initializeBlockStatement) + 1,
		`
			if (this._isMainFrame())
				promises.push(this._applySystemStealthOverride());
		`,
	);

	// Module-level cache for the browser binary's real full version. Spawning
	// --version on every FrameSession/context adds latency for multi-context
	// runs; the binary cannot change while the driver process is alive, so a
	// process-lifetime cache is safe.
	const patchwrightFullVersionCache = new Map<string, string>();
	function patchwrightCachedRealFullVersion(exe: string): string {
		const cached = patchwrightFullVersionCache.get(exe);
		if (cached)
			return cached;
		try {
			const out = require('child_process').execFileSync(exe, ['--version'], { timeout: 5000, windowsHide: true }).toString();
			const m = out.match(/(\d+\.\d+\.\d+\.\d+)/);
			const version = m ? m[1] : '';
			patchwrightFullVersionCache.set(exe, version);
			return version;
		} catch {
			patchwrightFullVersionCache.set(exe, '');
			return '';
		}
	}
}
