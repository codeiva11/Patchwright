import { type Project } from "ts-morph";
import { replaceRequired } from "./utils.ts";

// Headless Chrome emulates the page viewport as the physical screen. A 1280x720
// screen with a 1280x720 viewport is a strong headless marker. Keep the page
// viewport but expose a common desktop screen size when the caller did not set
// an explicit screen.
export function patchViewportSurface(project: Project) {
	const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/crPage.ts");
	let text = sourceFile.getFullText();
	text = replaceRequired(
		text,
		[
			"    const viewportSize = emulatedSize.viewport;",
			"    const screenSize = emulatedSize.screen;",
		].join("\n"),
		[
			"    const viewportSize = emulatedSize.viewport;",
			"    let screenSize = emulatedSize.screen;",
			"    if ((options.viewport === null || options.noDefaultViewport) && this._crPage._browserContext._browser.options.headless)",
			"      screenSize = { width: 1920, height: 1080 };",
			"    else if (!options.isMobile && !(options as any).screen && screenSize.width === viewportSize.width && screenSize.height === viewportSize.height && viewportSize.width >= 1000 && viewportSize.height >= 600)",
			"      screenSize = { width: 1920, height: 1080 };",
		].join("\n"),
		"crPage headless screen surface",
	);
	text = replaceRequired(
		text,
		"    if (!emulatedSize)\n      return;",
		[
			"    if (!emulatedSize) {",
			"      if (this._crPage._browserContext._browser.options.headless) {",
			"        try {",
			"          const metrics = await this._client.send('Page.getLayoutMetrics');",
			"          const viewport = metrics.cssLayoutViewport || metrics.layoutViewport;",
			"          if (viewport && viewport.clientWidth && viewport.clientHeight) {",
			"            await this._client.send('Emulation.setDeviceMetricsOverride', {",
			"              mobile: false,",
			"              width: viewport.clientWidth,",
			"              height: viewport.clientHeight,",
			"              screenWidth: 1920,",
			"              screenHeight: 1080,",
			"              deviceScaleFactor: 1,",
			"              screenOrientation: { angle: 0, type: 'landscapePrimary' },",
			"              dontSetVisibleSize: true,",
			"            });",
			"          }",
			"        } catch { }",
			"      }",
			"      return;",
			"    }",
		].join("\n"),
		"crPage null-viewport headless screen",
	);
	sourceFile.replaceWithText(text);
}
