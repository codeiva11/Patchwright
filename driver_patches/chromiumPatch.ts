import { type Project, SyntaxKind } from "ts-morph";

// ---------------------------
// server/chromium/chromium.ts
// ---------------------------
export function patchChromium(project: Project) {
	// Add source file to the project
	const chromiumSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromium.ts");

	// ------- Chromium Class -------
	const chromiumClass = chromiumSourceFile.getClassOrThrow("Chromium");

	// -- _innerDefaultArgs Method --
	const innerDefaultArgsMethod = chromiumClass.getMethodOrThrow("_innerDefaultArgs");

	// Upstream changed how the modern headless mode is selected between releases: older
	// Playwright gated `--headless=new` behind `process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW`,
	// while newer releases (Chrome >= 132, where legacy headless no longer exists) push plain
	// `--headless` unconditionally. Verify whichever shape this upstream has instead of
	// silently no-op'ing when the surrounding code changes between Playwright versions.
	const headlessNewIfStatements = innerDefaultArgsMethod
		.getDescendantsOfKind(SyntaxKind.IfStatement)
		.filter(ifStatement =>
			ifStatement.getExpression().getText().includes("process.env.PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW"),
		);
	if (headlessNewIfStatements.length > 0) {
		for (const ifStatement of headlessNewIfStatements)
			ifStatement.replaceWithText("chromeArguments.push('--headless=new');");
	} else if (!innerDefaultArgsMethod.getText().includes("chromeArguments.push('--headless')")) {
		throw new Error(
			"Patchwright patch target not found (chromium.ts headless mode): expected either a " +
				"PLAYWRIGHT_CHROMIUM_USE_HEADLESS_NEW check or an unconditional '--headless' push " +
				"— upstream Playwright source changed?",
		);
	}

	// Remove --enable-unsafe-swiftshader switches from innerDefaultArgs
	innerDefaultArgsMethod
		.getDescendantsOfKind(SyntaxKind.ExpressionStatement)
		.filter(statement => {
			return (
				statement.getText().includes("chromeArguments.push('--enable-unsafe-swiftshader')") ||
				statement.getText().includes('chromeArguments.push("--enable-unsafe-swiftshader")')
			);
		})
		.forEach(statement => {
			statement.remove();
		});
}
