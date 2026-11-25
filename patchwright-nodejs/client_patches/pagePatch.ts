import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined, bumpAssertMaxArguments } from "./utils.ts";

// --------------
// client/page.ts
// --------------
export function patchPage(project: Project) {
	// Add source file to the project
	const pageSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/client/page.ts");

	// ------- Page Class -------
	// Lazy Runtime.enable: console/pageerror listeners ask the existing
	// consoleMessages/pageErrors protocol methods to subscribe, which enables
	// Runtime only when the page actually needs it.
	{
		const sourceText = pageSourceFile.getFullText();
		const marker = "  static from(page: channels.PageChannel): Page {";
		const replacement = [
			"  override on(event: string | symbol, listener: (...args: any[]) => void): this {",
			"    if (event === Events.Page.Console) void this.consoleMessages({ filter: 'all' }).catch(() => { });",
			"    if (event === Events.Page.PageError) void this.pageErrors({ filter: 'all' }).catch(() => { });",
			"    return super.on(event, listener);",
			"  }",
			"",
			"  override addListener(event: string | symbol, listener: (...args: any[]) => void): this {",
			"    if (event === Events.Page.Console) void this.consoleMessages({ filter: 'all' }).catch(() => { });",
			"    if (event === Events.Page.PageError) void this.pageErrors({ filter: 'all' }).catch(() => { });",
			"    return super.addListener(event, listener);",
			"  }",
			"",
		].join("\n");
		pageSourceFile.replaceWithText(sourceText.replace(marker, replacement + marker));
	}
	const pageClass = pageSourceFile.getClassOrThrow("Page");
	pageClass.addProperty({ name: "routeInjecting", type: "boolean", initializer: "false" });
	
	// -- addInitScript Method --
	const addInitScriptMethod = pageClass.getMethodOrThrow("addInitScript");
	addInitScriptMethod.insertStatements(0, "await this.installInjectRoute();");
	
	// -- exposeBinding Method --
	const exposeBindingMethod = pageClass.getMethodOrThrow("exposeBinding");
	exposeBindingMethod.insertStatements(0, "await this.installInjectRoute();");
	
	// -- exposeFunction Method --
	const exposeFunctionMethod = pageClass.getMethodOrThrow("exposeFunction");
	exposeFunctionMethod.insertStatements(0, "await this.installInjectRoute();");
	
	// -- installInjectRoute Method --
	pageClass.addMethod({
		name: "installInjectRoute",
		isAsync: true,
	});
	const installInjectRouteMethod = pageClass.getMethodOrThrow("installInjectRoute");
	installInjectRouteMethod.setBodyText(`
		// No catch-all route: Page.addInitScript already runs in every new document.
		this.routeInjecting = true;
	`);
	
	// -- evaluate Method --
	const evaluateMethod = pageClass.getMethodOrThrow("evaluate");
	evaluateMethod.addParameter({
		name: "isolatedContext",
		type: "boolean",
		initializer: "false",
	});
	const evaluateAssertCall = assertDefined(
		evaluateMethod.getFirstDescendant(node =>
			node.isKind(SyntaxKind.CallExpression) &&
			node.getText().includes("assertMaxArguments")
		)
	).asKindOrThrow(SyntaxKind.CallExpression);
	bumpAssertMaxArguments(evaluateAssertCall);
	// Modify the function call inside the return statement to include 'isolatedContext'
	const evaluateMainFrameCall = assertDefined(
		evaluateMethod
			.getDescendantsOfKind(SyntaxKind.CallExpression)
			.find(call => call.getExpression().getText() === "this._mainFrame.evaluate")
	);
	evaluateMainFrameCall.addArgument("isolatedContext");
	
	// -- evaluateHandle Method --
	const evaluateHandleMethod = pageClass.getMethodOrThrow("evaluateHandle");
	evaluateHandleMethod.addParameter({
		name: "isolatedContext",
		type: "boolean",
		initializer: "false",
	});
	const evaluateHandleAssertCall = assertDefined(
		evaluateHandleMethod.getFirstDescendant(node =>
			node.isKind(SyntaxKind.CallExpression) &&
			node.getText().includes("assertMaxArguments")
		)
	).asKindOrThrow(SyntaxKind.CallExpression);
	bumpAssertMaxArguments(evaluateHandleAssertCall);
	// Modify the function call inside the return statement to include 'isolatedContext'
	const evaluateHandleMainFrameCall = assertDefined(
		evaluateHandleMethod
			.getDescendantsOfKind(SyntaxKind.CallExpression)
			.find(call => call.getExpression().getText() === "this._mainFrame.evaluateHandle")
	);
	evaluateHandleMainFrameCall.addArgument("isolatedContext");
}
