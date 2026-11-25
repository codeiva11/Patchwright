import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined, replaceRequired } from "./utils.ts";

// ----------------------------------
// server/chromium/crServiceWorker.ts
// ----------------------------------
export function patchCRServiceWorker(project: Project) {
	// Add source file to the project.
	const crServiceWorkerSourceFile = project.addSourceFileAtPath(
		"packages/playwright-core/src/server/chromium/crServiceWorker.ts",
	);

	// ------- CRServiceWorker Class -------
	const crServiceWorkerClass = crServiceWorkerSourceFile.getClassOrThrow("CRServiceWorker");

	// -- CRServiceWorker Constructor --
	const crServiceWorkerConstructorDeclaration = assertDefined(
		crServiceWorkerClass.getConstructors().find(ctor => {
			const params = ctor.getParameters();
			return (
				params[0]?.getName() === "browserContext" &&
				params[1]?.getName() === "session" &&
				params[2]?.getName() === "url"
			);
		}),
	);
	const crServiceWorkerConstructorBody = crServiceWorkerConstructorDeclaration
		.getBodyOrThrow()
		.asKindOrThrow(SyntaxKind.Block);

	// Find the Runtime.enable statement to remove
	crServiceWorkerConstructorBody
		.getStatements()
		.find(s => s.getText().includes("session.send") && s.getText().includes("Runtime.enable"))
		?.remove();

	if (!crServiceWorkerConstructorBody.getText().includes('expression: "globalThis"')) {
	crServiceWorkerConstructorBody.addStatements(`
		session._sendMayFail("Runtime.evaluate", {
			expression: "globalThis",
			serializationOptions: { serialization: "idOnly" }
		}).then(globalThis => {
			if (globalThis && globalThis.result && globalThis.result.objectId) {
				var globalThisObjId = globalThis.result.objectId;
				var executionContextId = parseInt(globalThisObjId.split(".")[1], 10);
				if (!isNaN(executionContextId)) {
					this.createExecutionContext(new CRExecutionContext(session, { id: executionContextId }));
				}
			}
		});
	`);
	}

	let text = crServiceWorkerSourceFile.getFullText();
	text = replaceRequired(
		text,
		"    session.send('Runtime.runIfWaitingForDebugger').catch(e => {});",
		`    const patchwrightResume = async () => {
      const native = (this.browserContext._browser as any).__patchwrightMetadata;
      if (native?.ua && native?.hev) {
        const fullVersionList = Array.isArray(native.hev.fullVersionList) ? native.hev.fullVersionList : [];
        await session.send('Emulation.setUserAgentOverride', {
          userAgent: String(native.ua).replace(/HeadlessChrome/g, 'Chrome'),
          userAgentMetadata: {
            brands: native.hev.brands,
            fullVersionList,
            fullVersion: (fullVersionList.find((entry: any) => entry.brand !== 'Chromium' && entry.brand !== 'Not.A/Brand') || fullVersionList[0] || {}).version || '',
            platform: native.hev.platform || '',
            platformVersion: native.hev.platformVersion || '',
            architecture: native.hev.architecture || '',
            model: native.hev.model || '',
            bitness: native.hev.bitness || '',
            mobile: !!native.hev.mobile,
            wow64: !!native.hev.wow64,
          },
        }).catch(() => { });
      }
      await session.send('Runtime.runIfWaitingForDebugger').catch(() => { });
    };
    void patchwrightResume();`,
		"CRServiceWorker native CH resume",
	);
	crServiceWorkerSourceFile.replaceWithText(text);
}
