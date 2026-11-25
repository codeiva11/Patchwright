import type { Project } from "ts-morph";

// -------------------
// injected/webAuthn.ts
// -------------------
export function patchCredentials(project: Project) {
	const webAuthnSourceFile = project.addSourceFileAtPath("packages/injected/src/webAuthn.ts");
	const injectFunction = webAuthnSourceFile.getFunctionOrThrow("inject");
	// Install the interceptor immediately, then wait for the lazy context's binding
	// wrapper when called. The wrapped binding is a native Proxy, so its
	// Function.prototype.toString is the native form, not an arrow source string.
	injectFunction.getVariableDeclarationOrThrow("binding").setInitializer(`async (payload: any) => {
		while (typeof (globalThis as any).__pwWebAuthnBinding !== 'function')
			await new Promise(resolve => globalThis.setTimeout(resolve, 0));
		return (globalThis as any).__pwWebAuthnBinding(payload);
	}`);
}
