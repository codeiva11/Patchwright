import type { Project } from "ts-morph";
import { replaceRequired } from "./utils.ts";


// ------------------------
// client/browserContext.ts
// ------------------------
export function patchBrowserContext(project: Project) {
	// Add source file to the project
	const browserContextSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/client/browserContext.ts");

	// ------- BrowserContext Class -------
	const browserContextClass = browserContextSourceFile.getClassOrThrow("BrowserContext");
	browserContextClass.addProperty({ name: "routeInjecting", type: "boolean", initializer: "false" });

	// -- addInitScript Method --
	const addInitScriptMethod = browserContextClass.getMethodOrThrow("addInitScript");
	addInitScriptMethod.insertStatements(0, "await this.installInjectRoute();");

	// -- exposeBinding Method --
	const exposeBindingMethod = browserContextClass.getMethodOrThrow("exposeBinding");
	exposeBindingMethod.insertStatements(0, "await this.installInjectRoute();");

	// -- exposeFunction Method --
	const exposeFunctionMethod = browserContextClass.getMethodOrThrow("exposeFunction");
	exposeFunctionMethod.insertStatements(0, "await this.installInjectRoute();");

	// -- installInjectRoute Method --
	browserContextClass.addMethod({
		name: "installInjectRoute",
		isAsync: true,
	});
	const installInjectRouteMethod = browserContextClass.getMethodOrThrow("installInjectRoute");
	installInjectRouteMethod.setBodyText(`
		// No catch-all route: addInitScript covers every document.
		this.routeInjecting = true;
	`);

	// -- constructor: wrap auto-dismiss dialog in internal zone to avoid trace pollution --
	// Patchwright always dispatches dialog events to the client (server patch). When no listener
	// is attached, the client auto-dismisses. Without this patch, the auto-dismiss creates a
	// "Dismiss dialog" trace entry. Wrapping in _wrapApiCall({ internal: true }) suppresses it.
	{
		let sourceText = browserContextSourceFile.getFullText();
		sourceText = replaceRequired(
			sourceText,
			"dialog.accept({}, kNoTimeout).catch(() => {});",
			"dialogObject._wrapApiCall(() => dialog.accept({}, kNoTimeout).catch(() => {}), { internal: true });",
			"client/browserContext.ts auto-dismiss accept wrapper",
		);
		sourceText = replaceRequired(
			sourceText,
			"dialog.dismiss({}, kNoTimeout).catch(() => {});",
			"dialogObject._wrapApiCall(() => dialog.dismiss({}, kNoTimeout).catch(() => {}), { internal: true });",
			"client/browserContext.ts auto-dismiss dismiss wrapper",
		);
		browserContextSourceFile.replaceWithText(sourceText);
	}
}
