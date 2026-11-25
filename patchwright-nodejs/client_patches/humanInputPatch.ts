import type { Project } from "ts-morph";

// --------------
// client/input.ts
// --------------
export function patchHumanInput(project: Project) {
	// Add source file to the project
	const inputSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/client/input.ts");

	// ------- module-level simulation helpers -------
	inputSourceFile.addStatements(`
		// ---------------------------------------------------------------------------
		// Patchwright: human-like input simulation helpers.
		// These run entirely client-side: organic Bézier mouse motion with acceleration,
		// deceleration and micro-jitter (Fitts's Law), Gaussian keystroke dynamics with
		// occasional typos, and inertial momentum scrolling.
		// ---------------------------------------------------------------------------
		function patchwrightSleep(ms: number): Promise<void> {
			return new Promise(resolve => setTimeout(resolve, ms));
		}

		function patchwrightGaussian(mean: number, std: number): number {
			let u = 0;
			let v = 0;
			while (u === 0)
				u = Math.random();
			while (v === 0)
				v = Math.random();
			return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
		}

		function patchwrightCubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
			const u = 1 - t;
			return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
		}
	`);

	// ------- Mouse Class -------
	const mouseClass = inputSourceFile.getClassOrThrow("Mouse");
	mouseClass.addProperty({
		name: "_humanPosition",
		type: "{ x: number; y: number; } | undefined",
		initializer: "undefined",
	});

	// -- moveHuman Method: organic Bézier movement --
	mouseClass.addMethod({
		name: "moveHuman",
		isAsync: true,
		parameters: [
			{ name: "x", type: "number" },
			{ name: "y", type: "number" },
			{
				name: "options",
				type: "{ steps?: number; jitter?: number; }",
				hasQuestionToken: true,
			},
		],
	});
	const moveHumanMethod = mouseClass.getMethodOrThrow("moveHuman");
	moveHumanMethod.setBodyText(`
		const start = this._humanPosition ?? { x, y };
		const dx = x - start.x;
		const dy = y - start.y;
		const distance = Math.hypot(dx, dy);
		if (distance < 1) {
			await this.move(x, y);
			this._humanPosition = { x, y };
			return;
		}
		const steps = options?.steps ?? Math.max(16, Math.min(64, Math.round(distance / 10)));
		const jitter = options?.jitter ?? Math.min(2, distance / 200);
		// Cubic Bézier control points with random lateral spread - like a human wrist arc.
		const c1 = {
			x: start.x + dx / 3 + patchwrightGaussian(0, distance / 6),
			y: start.y + dy / 3 + patchwrightGaussian(0, distance / 6),
		};
		const c2 = {
			x: start.x + dx * 2 / 3 + patchwrightGaussian(0, distance / 6),
			y: start.y + dy * 2 / 3 + patchwrightGaussian(0, distance / 6),
		};
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			// Smoothstep easing: fast acceleration out of the origin, deceleration into the
			// target (Fitts's Law), plus sub-pixel hand tremor along the way.
			const eased = t * t * (3 - 2 * t);
			const px = patchwrightCubicBezier(eased, start.x, c1.x, c2.x, x) + patchwrightGaussian(0, jitter);
			const py = patchwrightCubicBezier(eased, start.y, c1.y, c2.y, y) + patchwrightGaussian(0, jitter);
			await this.move(px, py, { steps: 1 });
			await patchwrightSleep(Math.max(2, patchwrightGaussian(9, 3)));
		}
		await this.move(x, y);
		this._humanPosition = { x, y };
	`);

	// -- scrollHuman Method: inertial momentum scrolling --
	mouseClass.addMethod({
		name: "scrollHuman",
		isAsync: true,
		parameters: [
			{ name: "deltaY", type: "number", initializer: "0" },
			{
				name: "options",
				type: "{ deltaX?: number; steps?: number; }",
				hasQuestionToken: true,
			},
		],
	});
	const scrollHumanMethod = mouseClass.getMethodOrThrow("scrollHuman");
	scrollHumanMethod.setBodyText(`
		const totalY = deltaY;
		const totalX = options?.deltaX ?? 0;
		const magnitude = Math.max(Math.abs(totalY), Math.abs(totalX)) || 100;
		const steps = options?.steps ?? Math.max(8, Math.min(48, Math.round(magnitude / 40)));
		let easedPrevious = 0;
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			// Momentum easing: quick pick-up, then an exponential-style glide to a stop,
			// like a flicked touchpad / mouse wheel.
			const eased = 1 - Math.pow(1 - t, 2.2);
			const stepY = (eased - easedPrevious) * totalY;
			const stepX = (eased - easedPrevious) * totalX;
			easedPrevious = eased;
			if (Math.abs(stepY) > 0.01 || Math.abs(stepX) > 0.01)
				await this.wheel(stepX, stepY);
			await patchwrightSleep(Math.max(2, patchwrightGaussian(12, 4)));
		}
	`);

	// ------- Keyboard Class -------
	const keyboardClass = inputSourceFile.getClassOrThrow("Keyboard");

	// -- typeHuman Method: Gaussian typing dynamics with occasional typos --
	keyboardClass.addMethod({
		name: "typeHuman",
		isAsync: true,
		parameters: [
			{ name: "text", type: "string" },
			{
				name: "options",
				type: "{ delayMean?: number; delayStd?: number; typoProbability?: number; }",
				hasQuestionToken: true,
			},
		],
	});
	const typeHumanMethod = keyboardClass.getMethodOrThrow("typeHuman");
	typeHumanMethod.setBodyText(`
		const delayMean = options?.delayMean ?? 105;
		const delayStd = options?.delayStd ?? 45;
		const typoProbability = options?.typoProbability ?? 0.02;
		const neighbors: Record<string, string> = {
			q: 'w', w: 'e', e: 'r', r: 't', t: 'y', y: 'u', u: 'i', i: 'o', o: 'p',
			a: 's', s: 'd', d: 'f', f: 'g', g: 'h', h: 'j', j: 'k', k: 'l',
			z: 'x', x: 'c', c: 'v', v: 'b', b: 'n', n: 'm',
		};
		for (const char of text) {
			await patchwrightSleep(Math.max(12, patchwrightGaussian(delayMean, delayStd) * (/[A-Z0-9]/.test(char) ? 1.35 : 1)));
			if (typoProbability > 0 && /[a-z]/.test(char) && Math.random() < typoProbability) {
				// Occasional slip to a neighboring key, noticed and corrected with Backspace.
				const wrong = neighbors[char] || String.fromCharCode(97 + Math.floor(Math.random() * 26));
				await this.type(wrong, { delay: 0 });
				await patchwrightSleep(Math.max(80, patchwrightGaussian(190, 60)));
				await this.press('Backspace');
				await patchwrightSleep(Math.max(40, patchwrightGaussian(130, 40)));
			}
			await this.type(char, { delay: 0 });
		}
	`);
}
