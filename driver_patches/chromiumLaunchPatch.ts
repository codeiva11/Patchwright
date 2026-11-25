import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ---------------------------
// server/chromium/chromium.ts
// ---------------------------
export function patchChromiumLaunch(project: Project) {
	const chromiumSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromium.ts");
	const chromiumClass = chromiumSourceFile.getClassOrThrow("Chromium");
	const innerDefaultArgsMethod = chromiumClass.getMethodOrThrow("_innerDefaultArgs");
	const proxyIfStatement = assertDefined(
		innerDefaultArgsMethod
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find(ifStatement => ifStatement.getExpression().getText() === "proxy"),
		"proxy if statement",
	);

	// WebRTC leak protection is proxy-only. Without a proxy, native host/mDNS
	// candidates must remain; an empty candidate list is itself a bot signal.
	const proxyBlock = proxyIfStatement.getThenStatement().asKindOrThrow(SyntaxKind.Block);
	proxyBlock.insertStatements(
		0,
		`
		// Patchwright: with a proxy, never expose a non-proxied interface IP.
		// Overridable with PATCHWRIGHT_WEBRTC_POLICY=<chromium policy value>.
		chromeArguments.push(\`--webrtc-ip-handling-policy=\${process.env.PATCHWRIGHT_WEBRTC_POLICY || 'disable_non_proxied_udp'}\`);
		chromeArguments.push('--enforce-webrtc-ip-permission-check');
	`,
	);



	// TLS/JA4 alignment is independent of the proxy and applies to every launch.
	const methodBlock = proxyIfStatement.getParentIfKindOrThrow(SyntaxKind.Block);
	// Headless Chromium 158 hangs service-worker history navigations when BFCache
	// is enabled (the upstream driver disables it). Keep native BFCache in
	// headful Chrome, where it is not an automation signal and does not hang.
	const chromeArgumentsStatement = assertDefined(
		methodBlock.getStatements().find(statement => statement.getText().startsWith('const chromeArguments = [...chromiumSwitches()]')),
		'chromiumArguments declaration',
	);
	methodBlock.insertStatements(chromeArgumentsStatement.getChildIndex() + 1, `
		if ((options as any).headless !== false)
			chromeArguments.push('--disable-back-forward-cache');
	`);
	methodBlock.insertStatements(
		methodBlock.getStatements().indexOf(proxyIfStatement) + 1,
		`
		// Patchwright: Chromium 152+ sends the trust_anchors extension (0xCA34).
		// Chrome and Edge ship it; some Brave builds do not. Enable it for all
		// Chromium-family browsers so JA4 matches Chrome. Opt out with
		// PATCHWRIGHT_TLS_ALIGN=0.
		if (process.env.PATCHWRIGHT_TLS_ALIGN !== '0')
			chromeArguments.push('--enable-features=TLSTrustAnchorIDs');
	`,
	);

	// Do not add --no-sandbox unless the caller explicitly disables it: the
	// Chromium sandbox is a native browser property and automation frameworks
	// that always pass --no-sandbox are easy to identify.
	const sandboxText = chromiumSourceFile.getFullText().replace(
		/if \(options\.chromiumSandbox !== true\)\s*\n\s*chromeArguments\.push\('--no-sandbox'\);/,
		"if (options.chromiumSandbox === false)\n      chromeArguments.push('--no-sandbox');",
	);
	if (!sandboxText.includes("options.chromiumSandbox === false"))
		throw new Error("Patchwright patch target not found (chromium.ts sandbox default)");
	chromiumSourceFile.replaceWithText(sandboxText);
}
