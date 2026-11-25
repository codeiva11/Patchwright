import { type Project, SyntaxKind } from "ts-morph";

// -----------------------------------
// server/chromium/chromiumSwitches.ts
// -----------------------------------
export function patchChromiumSwitches(project: Project) {
	// Add source file to the project
	const chromiumSwitchesSourceFile = project.addSourceFileAtPath(
		"packages/playwright-core/src/server/chromium/chromiumSwitches.ts",
	);

	// Keep native Presentation API errors consistent with regular Chrome.
	chromiumSwitchesSourceFile
		.getVariableDeclarationOrThrow("disabledFeatures")
		.getInitializerIfKindOrThrow(SyntaxKind.CallExpression)
		.getArguments()[0]
		.replaceWithText("feature => feature && feature !== 'MediaRouter'");

	// -- chromiumSwitches Array Variable --
	const chromiumSwitchesArrow = chromiumSwitchesSourceFile
		.getVariableDeclarationOrThrow("chromiumSwitches")
		.getInitializerIfKindOrThrow(SyntaxKind.ArrowFunction);

	const chromiumSwitchesArray = chromiumSwitchesArrow
		.getBody()
		.getFirstDescendantByKindOrThrow(SyntaxKind.ArrayLiteralExpression);

	// Patchwright defined switches to disable
	const switchesToDisable = [
		"assistantMode ? '' : '--enable-automation'",
		"'--disable-component-update'",
		"'--disable-default-apps'",
		"'--disable-extensions'",
		"'--disable-client-side-phishing-detection'",
		"'--disable-component-extensions-with-background-pages'",
		"'--allow-pre-commit-input'",
		"'--disable-ipc-flooding-protection'",
		"'--metrics-recording-only'",
		"'--unsafely-disable-devtools-self-xss-warnings'",
		"'--disable-back-forward-cache'",
	];
	chromiumSwitchesArray
		.getElements()
		.filter(element => switchesToDisable.includes(element.getText()))
		.forEach(element => {
			chromiumSwitchesArray.removeElement(element);
		});

	// Add custom switches to the array
	chromiumSwitchesArray.addElement(`'--disable-blink-features=AutomationControlled'`);

	// Component extensions create background service-worker targets that are
	// visible through CDP and interfere with automation. Disable only component
	// extensions; user-installed extensions remain supported.
	chromiumSwitchesArray.addElement(`'--disable-default-apps'`);
	chromiumSwitchesArray.addElement(`'--disable-component-extensions-with-background-pages'`);
}
