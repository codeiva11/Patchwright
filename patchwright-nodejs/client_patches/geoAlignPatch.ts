import type { Project } from "ts-morph";
import { assertDefined } from "./utils.ts";

// --------------------------
// client/browserContext.ts (helpers)
// client/browserType.ts (launch alignment)
// client/browser.ts (context alignment)
// --------------------------
export function patchGeoAlign(project: Project) {
	// Add source files to the project
	const browserContextSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/client/browserContext.ts");
	const browserTypeSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/client/browserType.ts");
	const browserSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/client/browser.ts");

	// ------- module-level helpers on browserContext.ts (imported by both consumers) -------
	browserContextSourceFile.addStatements(`
		// ---------------------------------------------------------------------------
		// Patchwright: proxy-timezone / geolocation / language auto-alignment.
		// Enabled with the geoAlign launch option or PATCHWRIGHT_GEO_ALIGN=1. A probe page
		// fetches a geo-IP endpoint through the browser (and therefore through the proxy),
		// and the resulting timezone, locale and geolocation are applied to the context.
		// ---------------------------------------------------------------------------
		const patchwrightCountryLocales: Record<string, string> = {
			US: 'en-US', GB: 'en-GB', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', IE: 'en-IE',
			IN: 'en-IN', ZA: 'en-ZA', PH: 'en-PH', SG: 'en-SG', PK: 'en-PK',
			DE: 'de-DE', AT: 'de-AT', CH: 'de-CH', FR: 'fr-FR', BE: 'fr-BE',
			ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', CL: 'es-CL', CO: 'es-CO', PE: 'es-PE',
			IT: 'it-IT', PT: 'pt-PT', BR: 'pt-BR', NL: 'nl-NL', SE: 'sv-SE',
			NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI', IS: 'is-IS', PL: 'pl-PL',
			CZ: 'cs-CZ', SK: 'sk-SK', HU: 'hu-HU', RO: 'ro-RO', BG: 'bg-BG',
			GR: 'el-GR', TR: 'tr-TR', RU: 'ru-RU', UA: 'uk-UA', BY: 'ru-BY',
			JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK',
			TH: 'th-TH', VN: 'vi-VN', ID: 'id-ID', MY: 'ms-MY', AE: 'ar-AE',
			SA: 'ar-SA', QA: 'ar-QA', EG: 'ar-EG', IL: 'he-IL', NG: 'en-NG',
			KE: 'en-KE', BD: 'bn-BD', LK: 'si-LK', NP: 'ne-NP',
		};

		function patchwrightLocaleForCountry(country: any): string | undefined {
			return typeof country === 'string' ? patchwrightCountryLocales[country.toUpperCase()] : undefined;
		}

		export async function patchwrightFetchProxyGeo(browser: any): Promise<{ timezoneId?: string, locale?: string, geolocation?: { latitude: number, longitude: number, accuracy: number } } | null> {
			try {
				const context = BrowserContext.from((await browser._channel.newContext({})).context);
				const page = await context.newPage();
				const endpoint = process.env.PATCHWRIGHT_GEO_ENDPOINT || 'https://ipinfo.io/json';
				const response = await page.goto(endpoint, { timeout: 20000 });
				const text = response ? await response.text() : '';
				await context.close();
				if (!text.trim().startsWith('{'))
					return null;
				const data = JSON.parse(text);
				let latitude: number | undefined;
				let longitude: number | undefined;
				const locationString = typeof data.location === 'string' ? data.location : typeof data.loc === 'string' ? data.loc : undefined;
				if (locationString) {
					const [lat, lon] = locationString.split(',').map(Number);
					if (Number.isFinite(lat) && Number.isFinite(lon)) {
						latitude = lat;
						longitude = lon;
					}
				} else if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
					latitude = data.latitude;
					longitude = data.longitude;
				}
				const timezoneId = typeof data.timezone === 'string' ? data.timezone : undefined;
				const locale = patchwrightLocaleForCountry(data.country ?? data.country_code)
					?? (typeof data.languages === 'string' ? data.languages.split(',')[0].trim() : undefined);
				const geo: { timezoneId?: string, locale?: string, geolocation?: { latitude: number, longitude: number, accuracy: number } } = {};
				if (timezoneId)
					geo.timezoneId = timezoneId;
				if (locale)
					geo.locale = locale;
				if (latitude !== undefined && longitude !== undefined)
					geo.geolocation = { latitude, longitude, accuracy: 30 };
				return geo.timezoneId || geo.locale || geo.geolocation ? geo : null;
			} catch (error) {
				console.warn(\`Patchwright: proxy geo alignment failed: \${error}\`);
				return null;
			}
		}
	`);

	// ------- browserType.ts: make the helper importable -------
	addNamedBrowserContextImport(browserTypeSourceFile, "patchwrightFetchProxyGeo");
	// ------- browser.ts: import the helper -------
	addNamedBrowserContextImport(browserSourceFile, "patchwrightFetchProxyGeo");

	// ------- BrowserType Class -------
	const browserTypeClass = browserTypeSourceFile.getClassOrThrow("BrowserType");

	// -- _patchwrightProbeGeo Method: throwaway browser probe for persistent launches --
	browserTypeClass.addMethod({
		name: "_patchwrightProbeGeo",
		isAsync: true,
		parameters: [{ name: "options", type: "any" }],
	});
	const probeGeoMethod = browserTypeClass.getMethodOrThrow("_patchwrightProbeGeo");
	probeGeoMethod.setBodyText(`
		try {
			const probeParams: channels.BrowserTypeLaunchParams = {
				channel: options.channel,
				headless: true,
				proxy: options.proxy,
				args: options.args,
				executablePath: options.executablePath,
				env: options.env ? envObjectToArray(options.env) : undefined,
			};
			const result = await this._channel.launch(probeParams, new TimeoutSettings().launchTimeout(options));
			const probeBrowser = Browser.from(result.browser);
			// The probe browser was created directly from the channel without the regular
			// launch() wiring - wire up the browser type so close/disconnect paths work.
			probeBrowser._browserType = this;
			try {
				return await patchwrightFetchProxyGeo(probeBrowser);
			} finally {
				await probeBrowser.close().catch(() => { });
			}
		} catch (error) {
			console.warn(\`Patchwright: proxy geo alignment failed: \${error}\`);
			return null;
		}
	`);

	// -- launch(): strip the geoAlign option (client-side only) --
	const launchMethod = browserTypeClass.getMethodOrThrow("launch");
	launchMethod.insertStatements(0, `
		const { geoAlign: launchGeoAlign, ...launchRestOptions } = options as any;
		options = launchRestOptions;
		const patchwrightGeoWanted = launchGeoAlign ?? (!!process.env.PATCHWRIGHT_GEO_ALIGN && process.env.PATCHWRIGHT_GEO_ALIGN !== '0');
		if (patchwrightGeoWanted && !(options as any).timezoneId)
			console.warn('Patchwright: geoAlign needs context options - with launch() the timezone is applied on the auto-created context via browser.newPage()/newContext().');
	`);

	// -- launchPersistentContext(): strip the option, probe, then merge geo into contextParams --
	const launchPersistentContextMethod = browserTypeClass.getMethodOrThrow("launchPersistentContext");
	launchPersistentContextMethod.insertStatements(0, `
		const { geoAlign: persistentGeoAlign, ...persistentRestOptions } = options as any;
		options = persistentRestOptions;
		const patchwrightGeoWanted = persistentGeoAlign ?? (!!process.env.PATCHWRIGHT_GEO_ALIGN && process.env.PATCHWRIGHT_GEO_ALIGN !== '0');
	`);
	{
		const contextParamsStatement = assertDefined(
			launchPersistentContextMethod
				.getStatements()
				.find(statement =>
					statement.getText().includes("const contextParams = await prepareBrowserContextParams(options)"),
				),
		);
		launchPersistentContextMethod.insertStatements(
			contextParamsStatement.getChildIndex() + 1,
			`
		if (patchwrightGeoWanted && !(options as any).timezoneId) {
			const patchwrightGeo = await this._patchwrightProbeGeo(options);
			if (patchwrightGeo)
				Object.assign(contextParams, patchwrightGeo);
		}
	`,
		);
	}

	// ------- Browser Class: align every new context on an already launched browser -------
	const innerNewContextMethod = browserSourceFile.getClassOrThrow("Browser").getMethodOrThrow("_innerNewContext");
	innerNewContextMethod.insertStatements(0, `
		const { geoAlign: innerGeoAlign, ...innerRestOptions } = userOptions as any;
		userOptions = innerRestOptions;
		const patchwrightGeoWanted = innerGeoAlign ?? (!!process.env.PATCHWRIGHT_GEO_ALIGN && process.env.PATCHWRIGHT_GEO_ALIGN !== '0');
	`);
	{
		const contextParamsStatement = assertDefined(
			innerNewContextMethod
				.getStatements()
				.find(statement =>
					statement.getText().includes("const contextOptions = await prepareBrowserContextParams(options)"),
				),
		);
		innerNewContextMethod.insertStatements(
			contextParamsStatement.getChildIndex() + 1,
			`
		if (patchwrightGeoWanted && !contextOptions.timezoneId && this._browserType.name() === 'chromium') {
			const patchwrightGeo = await patchwrightFetchProxyGeo(this);
			if (patchwrightGeo)
				Object.assign(contextOptions, patchwrightGeo);
		}
	`,
		);
	}
}

function addNamedBrowserContextImport(sourceFile: any, namedImport: string) {
	const importDeclaration = assertDefined(
		sourceFile
			.getImportDeclarations()
			.find((declaration: any) => declaration.getModuleSpecifier().getText() === "'./browserContext'"),
		"./browserContext import",
	);
	const namedImports = importDeclaration.getNamedImports();
	if (!namedImports.some((element: any) => element.getName() === namedImport))
		importDeclaration.addNamedImport(namedImport);
}
