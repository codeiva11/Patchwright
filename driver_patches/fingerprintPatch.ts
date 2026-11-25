import { type Project, SyntaxKind } from "ts-morph";
import { assertDefined } from "./utils.ts";

// ------------------------
// server/browserContext.ts
// ------------------------
export function patchFingerprint(project: Project) {
	// Add source file to the project
	const browserContextSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/browserContext.ts");

	// -- module-level helper that builds the fingerprint init script --
	browserContextSourceFile.addStatements(`
		// Patchwright: opt-in fingerprint alignment, driven by PATCHWRIGHT_FINGERPRINT=<json>.
		// Supported fields: hardwareConcurrency, deviceMemory, platform, userAgent,
		// webglVendor, webglRenderer, canvasNoise, permissions { granted, denied, delay }.
		function patchwrightFingerprintScript(cfg: any): string {
			return \`(function() {
				'use strict';
				const cfg = \${JSON.stringify(cfg)};
				const defineGetter = (target, prop, getter) => {
					try {
						Object.defineProperty(target, prop, { get: getter, configurable: true, enumerable: true });
					} catch (e) { }
				};
				const maskAsNative = (fn, name) => {
					try {
						Object.defineProperty(fn, 'toString', {
							value: () => 'function ' + name + '() { [native code] }',
							configurable: true,
							writable: true,
						});
					} catch (e) { }
				};
				if (typeof cfg.hardwareConcurrency === 'number')
					defineGetter(navigator, 'hardwareConcurrency', () => cfg.hardwareConcurrency);
				if (typeof cfg.deviceMemory === 'number')
					defineGetter(navigator, 'deviceMemory', () => cfg.deviceMemory);
				if (cfg.platform)
					defineGetter(navigator, 'platform', () => cfg.platform);
				if (cfg.userAgent)
					defineGetter(navigator, 'userAgent', () => cfg.userAgent);
				if (cfg.webglVendor || cfg.webglRenderer) {
					const hookGlPrototype = proto => {
						if (!proto || !proto.getParameter || proto.getParameter.__patchwright)
							return;
						const original = proto.getParameter;
						const patched = function(parameter) {
							if (parameter === 0x9245 && cfg.webglVendor)
								return cfg.webglVendor;
							if (parameter === 0x9246 && cfg.webglRenderer)
								return cfg.webglRenderer;
							return original.call(this, parameter);
						};
						patched.__patchwright = true;
						maskAsNative(patched, 'getParameter');
						proto.getParameter = patched;
					};
					try {
						hookGlPrototype(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
						hookGlPrototype(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
					} catch (e) { }
				}
				if (cfg.canvasNoise) {
					const seed = (Math.random() * 0x7fffffff) | 0;
					const noiseAt = (x, y) => {
						let h = (x * 374761393 + y * 668265263 + seed * 69069) & 0x7fffffff;
						h = (h ^ (h >>> 13)) * 1274126177;
						return ((h ^ (h >>> 16)) & 0x7fffffff) / 0x7fffffff;
					};
					const noisify = imageData => {
						const data = imageData.data;
						for (let i = 0; i < data.length; i += 4) {
							const pixel = i >> 2;
							if (noiseAt(pixel % imageData.width, (pixel / imageData.width) | 0) < 0.08)
								data[i] = data[i] ^ 1;
						}
						return imageData;
					};
					const contextProto = CanvasRenderingContext2D.prototype;
					const originalGetImageData = contextProto.getImageData;
					if (!originalGetImageData.__patchwright) {
						const patchedGetImageData = function(x, y, w, h) {
							return noisify(originalGetImageData.call(this, x, y, w, h));
						};
						patchedGetImageData.__patchwright = true;
						maskAsNative(patchedGetImageData, 'getImageData');
						contextProto.getImageData = patchedGetImageData;
					}
					const cloneNoisified = canvas => {
						const copy = document.createElement('canvas');
						copy.width = canvas.width;
						copy.height = canvas.height;
						const copyContext = copy.getContext('2d');
						copyContext.drawImage(canvas, 0, 0);
						const image = originalGetImageData.call(copyContext, 0, 0, copy.width, copy.height);
						noisify(image);
						copyContext.putImageData(image, 0, 0);
						return copy;
					};
					const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
					if (!originalToDataURL.__patchwright) {
						const patchedToDataURL = function() {
							try {
								if (this.width && this.height)
									return originalToDataURL.apply(cloneNoisified(this), arguments);
							} catch (e) { }
							return originalToDataURL.apply(this, arguments);
						};
						patchedToDataURL.__patchwright = true;
						maskAsNative(patchedToDataURL, 'toDataURL');
						HTMLCanvasElement.prototype.toDataURL = patchedToDataURL;
					}
					const originalToBlob = HTMLCanvasElement.prototype.toBlob;
					if (!originalToBlob.__patchwright) {
						const patchedToBlob = function(callback, type, quality) {
							try {
								if (this.width && this.height)
									return originalToBlob.call(cloneNoisified(this), callback, type, quality);
							} catch (e) { }
							return originalToBlob.call(this, callback, type, quality);
						};
						patchedToBlob.__patchwright = true;
						maskAsNative(patchedToBlob, 'toBlob');
						HTMLCanvasElement.prototype.toBlob = patchedToBlob;
					}
				}
				if (cfg.permissions && navigator.permissions && navigator.permissions.query) {
					const originalQuery = navigator.permissions.query.bind(navigator.permissions);
					const align = (status, stateOverride) => {
						const aligned = Object.create(Object.getPrototypeOf(status));
						for (const key of ['state', 'name', 'onchange']) {
							try {
								Object.defineProperty(aligned, key, {
									get: () => (key === 'state' && stateOverride ? stateOverride : status[key]),
									set: key === 'onchange' ? value => { status.onchange = value; } : undefined,
									configurable: true,
									enumerable: true,
								});
							} catch (e) { }
						}
						return aligned;
					};
				const patchedQuery = descriptor => {
					const run = () => originalQuery(descriptor).then(status => {
						const name = descriptor && descriptor.name;
						if (cfg.permissions.granted && cfg.permissions.granted.includes(name))
							return align(status, 'granted');
						if (cfg.permissions.denied && cfg.permissions.denied.includes(name))
							return align(status, 'denied');
						if (name === 'notifications' && cfg.permissions.alignNotifications !== false) {
							const notificationState = typeof Notification !== 'undefined' ? Notification.permission : undefined;
							if (notificationState && notificationState !== status.state)
								return align(status, notificationState);
						}
						return status;
					});
						return cfg.permissions.delay ? new Promise(resolve => setTimeout(() => resolve(run()), cfg.permissions.delay)) : run();
					};
					maskAsNative(patchedQuery, 'query');
					defineGetter(navigator.permissions, 'query', () => patchedQuery);
				}
			})();\`;
		}
	`);

	// -- initialize(): inject the fingerprint script and optional permission grants --
	const browserContextClass = browserContextSourceFile.getClassOrThrow("BrowserContext");
	const initializeMethod = browserContextClass.getMethodOrThrow("initialize");
	const permissionsIfStatement = assertDefined(
		initializeMethod
			.getDescendantsOfKind(SyntaxKind.IfStatement)
			.find(ifStatement => ifStatement.getExpression().getText() === "this._options.permissions"),
		"permissions if statement",
	);
	const initializeBlock = permissionsIfStatement.getParentIfKindOrThrow(SyntaxKind.Block);
	initializeBlock.insertStatements(
		initializeBlock.getStatements().indexOf(permissionsIfStatement),
		`
		// Patchwright: opt-in fingerprint alignment (PATCHWRIGHT_FINGERPRINT=<json>).
		if (process.env.PATCHWRIGHT_FINGERPRINT) {
			try {
				await this.addInitScript(nullProgress, patchwrightFingerprintScript(JSON.parse(process.env.PATCHWRIGHT_FINGERPRINT)));
			} catch (error) {
				console.warn(\`Patchwright: invalid PATCHWRIGHT_FINGERPRINT: \${error}\`);
			}
		}
		// Patchwright: opt-in CDP-level permission grants (PATCHWRIGHT_PERMISSIONS=a,b,c|all).
		// These are granted through the browser itself, so no script injection is involved.
		const patchwrightPermissions = process.env.PATCHWRIGHT_PERMISSIONS;
		if (patchwrightPermissions) {
			const patchwrightPermissionList = patchwrightPermissions.trim().toLowerCase() === 'all'
				? [
						'geolocation',
						'notifications',
						'camera',
						'microphone',
						'midi',
						'background-sync',
						'background-fetch',
						'local-fonts',
						'persistent-storage',
						'screen-wake-lock',
						'storage-access',
						'top-level-storage-access',
						'clipboard-read',
						'clipboard-write',
					]
				: patchwrightPermissions.split(',').map(permission => permission.trim()).filter(Boolean);
			await this.grantPermissions(patchwrightPermissionList);
		}
	`,
	);
}
