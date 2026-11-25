import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined, replaceRequired } from "./utils.ts";

// -------------------------
// server/chromium/crPage.ts
// -------------------------
// Patchwright: keep the browser's native identity and only remove the
// HeadlessChrome token. Native Client Hints (brand list, full versions,
// platformVersion, architecture, bitness) come from a short-lived
// chrome://version target. This avoids the previous empty/guessed metadata.
export function patchSystemStealth(project: Project) {
	const crPageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crPage.ts");
	const frameSessionClass = crPageSourceFile.getClassOrThrow("FrameSession");

	frameSessionClass.addMethod({ name: "_applySystemStealthOverride", isAsync: true });
	const stealthMethod = frameSessionClass.getMethodOrThrow("_applySystemStealthOverride");
	stealthMethod.setBodyText(`
		try {
			if (process.env.PATCHWRIGHT_SYSTEM_STEALTH === '0')
				return;
			const browser = this._crPage._browserContext._browser;
			const native = await patchwrightFallbackMetadata(browser);
			if (!native?.ua || !native?.hev || !Array.isArray(native.hev.brands) || !native.hev.brands.length)
				return;
			// Service workers attach through a separate target and inherit the
			// browser's native UA, not this page override. Publish the resolved
			// metadata so crServiceWorker can apply the same override before it
			// resumes the worker script.
			(browser as any).__patchwrightMetadata = native;
			const userAgent = native.ua.replace(/HeadlessChrome/g, 'Chrome');
			const brands = native.hev.brands.map((entry: any) => entry.brand === 'HeadlessChrome' ? { ...entry, brand: 'Google Chrome' } : entry);
			const fullVersionList = (Array.isArray(native.hev.fullVersionList) ? native.hev.fullVersionList : []).map((entry: any) => entry.brand === 'HeadlessChrome' ? { ...entry, brand: 'Google Chrome' } : entry);
			const fullVersion = (fullVersionList.find((entry: any) => entry.brand !== 'Chromium' && entry.brand !== 'Not.A/Brand') || fullVersionList[0] || {}).version || '';
			await this._client.send('Network.setUserAgentOverride', {
				userAgent,
				userAgentMetadata: {
					brands,
					fullVersionList,
					fullVersion,
					platform: native.hev.platform || '',
					platformVersion: native.hev.platformVersion || '',
					architecture: native.hev.architecture || '',
					model: native.hev.model || '',
					bitness: native.hev.bitness || '',
					mobile: !!native.hev.mobile,
					wow64: !!native.hev.wow64,
				},
			});
		} catch (e) {
			// Stealth is best-effort; never break page creation.
		}
	`);

	// Read native metadata once per browser executable from a temporary
	// chrome://version target. about:blank and data: URLs do not expose
	// navigator.userAgentData, so the old snapshot always returned empty values.
	crPageSourceFile.addStatements(`
		type PatchwrightMetadata = { ua: string; brave: boolean; hev: any; chromiumVersion?: string };
		const patchwrightMetadataCache = new Map<string, PatchwrightMetadata>();
		const patchwrightMetadataPromises = new Map<string, Promise<PatchwrightMetadata | null>>();

		async function patchwrightReadNativeMetadata(browser: any): Promise<PatchwrightMetadata | null> {
			const options = browser.options;
			const key = [options.customExecutablePath || options.channel || options.name, process.platform, process.arch].join('|');
			const cached = patchwrightMetadataCache.get(key);
			if (cached)
				return cached;
			const pending = patchwrightMetadataPromises.get(key);
			if (pending)
				return await pending;
			const promise = (async (): Promise<PatchwrightMetadata | null> => {
				let root: any;
				let targetId: string | undefined;
				let session: any;
				const send = (target: any, method: string, params?: any) => target._send(method, params);
				const executableName = String(options.customExecutablePath || options.executablePath || '').toLowerCase();
				const isEdge = String(options.channel || '').toLowerCase().includes('edge') || executableName.includes('msedge');
				const versionUrl = isEdge ? 'edge://version' : 'chrome://version';
				try {
					root = await browser._clientRootSession();
					const created = await send(root, 'Target.createTarget', { url: 'about:blank', background: true });
					targetId = created.targetId;
					session = await root.attachToTarget(targetId);
					await send(session, 'Page.navigate', { url: versionUrl }).catch(() => { });
					await new Promise(resolve => setTimeout(resolve, 500));
					const result = await send(session, 'Runtime.evaluate', {
						expression: \`(async () => {
							const ua = navigator.userAgent;
							const brave = !!navigator.brave;
							const hev = navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['brands', 'fullVersionList', 'platform', 'platformVersion', 'architecture', 'bitness', 'model', 'mobile', 'wow64']).catch(() => null) : null;
							let versionText = '';
							for (let i = 0; i < 100; i++) {
								versionText = document.body ? (document.body.textContent || '') : '';
								if (/Chromium version/i.test(versionText))
									break;
								await new Promise(resolve => setTimeout(resolve, 25));
							}
							const chromiumVersion = (versionText.match(/Chromium version[\\s\\u00a0]+([\\d.]+)/i) || [])[1] || '';
							return JSON.stringify({ ua, brave, hev, chromiumVersion });
						})()\`,
						returnByValue: true,
						awaitPromise: true,
					});
					const value = result?.result?.value;
					if (!value)
						return null;
					const parsed = JSON.parse(value) as PatchwrightMetadata;
					if (!parsed.ua || !parsed.hev)
						return await patchwrightFallbackMetadata(browser);
					patchwrightMetadataCache.set(key, parsed);
					return parsed;
				} catch {
					return await patchwrightFallbackMetadata(browser);
				} finally {
					// Closing the target also detaches its flattened session.
					try { if (targetId && root) await send(root, 'Target.closeTarget', { targetId }); } catch { }
					patchwrightMetadataPromises.delete(key);
				}
			})();
			patchwrightMetadataPromises.set(key, promise);
			return await promise;
		}

		// Fallback for browsers that block chrome://version targets (notably
		// some Brave builds): synthesize the same native metadata from
		// Browser.getVersion and the executable identity. Never leave the
		// HeadlessChrome token in the UA.
		const patchwrightFallbackCache = new Map<string, PatchwrightMetadata>();
		async function patchwrightFallbackMetadata(browser: any): Promise<PatchwrightMetadata | null> {
			const options = browser.options;
			const key = [options.customExecutablePath || options.executablePath || options.channel || options.name, process.platform, process.arch].join('|');
			const cached = patchwrightFallbackCache.get(key);
			if (cached)
				return cached;
			try {
				const root = await browser._clientRootSession();
				const version = await root._send('Browser.getVersion');
				const product = String(version?.product || '');
				const fullVersion = product.split('/')[1] || '0.0.0.0';
				const majorVersion = fullVersion.split('.')[0] || '0';
				const executable = String(options.customExecutablePath || options.executablePath || '').toLowerCase();
				const channel = String(options.channel || '').toLowerCase();
				const brave = channel.includes('brave') || executable.includes('brave');
				const edge = channel.includes('edge') || channel.includes('msedge') || executable.includes('msedge');
				const brand = brave ? 'Brave' : edge ? 'Microsoft Edge' : 'Google Chrome';
				const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
				const platformVersion = platform === 'Windows' ? '19.0.0' : platform === 'macOS' ? '15.0.0' : '';
				const result: PatchwrightMetadata = {
					ua: String(browser.userAgent() || '').replace(/HeadlessChrome/g, 'Chrome'),
					brave,
					hev: {
						brands: [
							{ brand: 'Chromium', version: majorVersion },
							{ brand: 'Not.A/Brand', version: '24' },
							{ brand, version: majorVersion },
						],
						fullVersionList: [
							{ brand: 'Chromium', version: fullVersion },
							{ brand: 'Not.A/Brand', version: '24.0.0.0' },
							{ brand, version: fullVersion },
						],
						platform,
						platformVersion,
						architecture: 'x86',
						model: '',
						bitness: '64',
						mobile: false,
						wow64: false,
					},
				};
				patchwrightFallbackCache.set(key, result);
				return result;
			} catch {
				return null;
			}
		}
	`);

	// Apply the override to every frame session, not only the main frame.
	// Cross-origin iframes (OOPIFs) have their own CDP target and do not inherit
	// the main target's Network.setUserAgentOverride.
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
			promises.push(this._applySystemStealthOverride());
		`,
	);
}

// ---------------------------------------------------------------------------
// Lazy console/pageerror plumbing. Runtime.enable is observable, so it must
// run only after a user attaches a console/pageerror listener. The public Page
// client calls the existing consoleMessages()/pageErrors() protocol methods
// from its on()/addListener() override; those dispatchers enable Runtime.
// ---------------------------------------------------------------------------
export function patchLazyConsole(project: Project) {
	{
		const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/page.ts");
		let text = sourceFile.getFullText();
		text = replaceRequired(text, "  bringToFront(): Promise<void>;\n", "  bringToFront(): Promise<void>;\n  enableConsole?(): Promise<void>;\n", "PageDelegate.enableConsole");
		text = replaceRequired(
			text,
			"  async bringToFront(progress: Progress): Promise<void> {\n    await progress.race(this.delegate.bringToFront());\n  }\n",
			"  async bringToFront(progress: Progress): Promise<void> {\n    await progress.race(this.delegate.bringToFront());\n  }\n\n  async enableConsole(progress: Progress): Promise<void> {\n    await progress.race(this.delegate.enableConsole?.());\n  }\n",
			"Page.enableConsole",
		);
		sourceFile.replaceWithText(text);
	}
	{
		const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crPage.ts");
		let text = sourceFile.getFullText();
		text = replaceRequired(
			text,
			"  async bringToFront(): Promise<void> {\n    await this._mainFrameSession._client.send('Page.bringToFront');\n  }\n",
			"  async bringToFront(): Promise<void> {\n    await this._mainFrameSession._client.send('Page.bringToFront');\n  }\n\n  async enableConsole(): Promise<void> {\n    this._consoleEnabled = true;\n    await Promise.all([...this._sessions.values()].map(async session => {\n      await session._client.send('Log.enable').catch(() => { });\n      await session._client.send('Runtime.enable').catch(() => { });\n    }));\n  }\n",
			"CRPage.enableConsole",
		);
		text = replaceRequired(text, "      this._client.send('Log.enable', {}),\n", "", "CRPage startup Log.enable");
		sourceFile.replaceWithText(text);
	}
	{
		const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/dispatchers/pageDispatcher.ts");
		let text = sourceFile.getFullText();
		text = replaceRequired(
			text,
			"    this._subscriptions.add('console');\n    return {",
			"    this._subscriptions.add('console');\n    await this._page.enableConsole(progress);\n    return {",
			"PageDispatcher.consoleMessages enable",
		);
		text = replaceRequired(
			text,
			"  async pageErrors(params: channels.PagePageErrorsParams, progress: Progress): Promise<channels.PagePageErrorsResult> {\n    return {",
			"  async pageErrors(params: channels.PagePageErrorsParams, progress: Progress): Promise<channels.PagePageErrorsResult> {\n    await this._page.enableConsole(progress);\n    return {",
			"PageDispatcher.pageErrors enable",
		);
		sourceFile.replaceWithText(text);
	}
}
