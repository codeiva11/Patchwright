import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ---------------------------
// server/chromium/chromium.ts
// ---------------------------
export function patchChromiumLaunch(project: Project) {
	// Add source file to the project
	const chromiumSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromium.ts");

	// ------- Chromium Class -------
	const chromiumClass = chromiumSourceFile.getClassOrThrow("Chromium");

	// -- _innerDefaultArgs Method: WebRTC IP leak protection --
	const innerDefaultArgsMethod = chromiumClass.getMethodOrThrow("_innerDefaultArgs");
	// Locate the `if (proxy) { ... }` block that configures --proxy-server.
	const proxyIfStatement = assertDefined(
		innerDefaultArgsMethod
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find(ifStatement => ifStatement.getExpression().getText() === "proxy"),
		"proxy if statement",
	);
	// WebRTC must report the routed (proxy) IP, never the machine's real one. With a proxy,
	// non-proxied UDP is disabled (WebRTC itself stays fully functional, so sites have no reason
	// to get suspicious); without a proxy, only the default public interface is exposed, which
	// hides local IPs from STUN requests.
	const proxyBlock = proxyIfStatement.getParentIfKindOrThrow(SyntaxKind.Block);
	proxyBlock.insertStatements(
		proxyBlock.getStatements().indexOf(proxyIfStatement) + 1,
		`
		// Patchwright: WebRTC IP leak protection. Always restrict non-proxied UDP so
		// WebRTC never exposes an interface IP that differs from the connection the site
		// sees (dual-stack machines where the page goes over IPv6 but STUN reports the
		// IPv4 interface are a classic authenticity-score deduction, e.g. BrowserScan).
		// Overridable with PATCHWRIGHT_WEBRTC_POLICY=<chromium policy value>.
		chromeArguments.push(\`--webrtc-ip-handling-policy=\${process.env.PATCHWRIGHT_WEBRTC_POLICY || 'disable_non_proxied_udp'}\`);
		chromeArguments.push('--enforce-webrtc-ip-permission-check');

		// Patchwright: TLS/JA4 alignment. Chromium 152+ sends the trust_anchors extension
		// (0xCA34) in every ClientHello, which moves JA4 from t13d1516h2 to t13d1517h2 —
		// the fingerprint every server sees BEFORE any page code runs. Chrome and Edge
		// ship it by default, but Brave builds do not enable it, so Brave's ClientHello
		// looks one Chromium generation older than the Chrome identity it claims.
		// Enabling the TLSTrustAnchorIDs feature makes Brave's JA4 byte-for-byte equal to
		// real Chrome's (t13d1517h2_8daaf6152771_cb7bf5808d99). It is a no-op for
		// browsers that already send the extension. Opt out with PATCHWRIGHT_TLS_ALIGN=0.
		// Applied unconditionally: it is a no-op for browsers that already send the
		// extension (Chrome, Edge, Chromium) and covers auto-resolved system browsers
		// where the executable is not known until resolveExecutablePath() runs.
		if (process.env.PATCHWRIGHT_TLS_ALIGN !== '0')
			chromeArguments.push('--enable-features=TLSTrustAnchorIDs');
	`,
	);
}
