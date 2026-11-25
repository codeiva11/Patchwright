import fs from "node:fs";
import path from "node:path";

function replaceInFile(filePath: string, replacements: Array<[string | RegExp, string]>) {
	if (!fs.existsSync(filePath)) return;
	let content = fs.readFileSync(filePath, "utf8");
	for (const [from, to] of replacements) {
		content = typeof from === "string" ? content.split(from).join(to) : content.replace(from, to);
	}
	fs.writeFileSync(filePath, content, "utf8");
}

function replaceInDir(dirPath: string, replacements: Array<[string | RegExp, string]>, extensions = [".js", ".mjs", ".cjs", ".d.ts", ".json", ".md"]) {
	if (!fs.existsSync(dirPath)) return;
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules" && entry.name !== ".git") {
				replaceInDir(fullPath, replacements, extensions);
			}
		} else if (extensions.some(ext => entry.name.endsWith(ext))) {
			replaceInFile(fullPath, replacements);
		}
	}
}

export function rebrandToPatchwright() {
	const cwd = process.cwd();
	const packagesDir = path.join(cwd, "packages");

	console.log(`[patchwright_rebranding] Starting rebranding to Patchwright in: ${packagesDir}`);

	// 1. Identify existing directories (support both raw Playwright and partially rebranded Patchright)
	const coreSource = fs.existsSync(path.join(packagesDir, "patchright-core"))
		? path.join(packagesDir, "patchright-core")
		: path.join(packagesDir, "playwright-core");

	const mainSource = fs.existsSync(path.join(packagesDir, "patchright"))
		? path.join(packagesDir, "patchright")
		: path.join(packagesDir, "playwright");

	const coreTarget = path.join(packagesDir, "patchwright-core");
	const mainTarget = path.join(packagesDir, "patchwright");

	// Rename core directory if needed
	if (coreSource !== coreTarget && fs.existsSync(coreSource)) {
		console.log(`[patchwright_rebranding] Renaming ${path.basename(coreSource)} -> patchwright-core`);
		if (fs.existsSync(coreTarget)) fs.rmSync(coreTarget, { recursive: true, force: true });
		fs.renameSync(coreSource, coreTarget);
	}

	// Rename main directory if needed
	if (mainSource !== mainTarget && fs.existsSync(mainSource)) {
		console.log(`[patchwright_rebranding] Renaming ${path.basename(mainSource)} -> patchwright`);
		if (fs.existsSync(mainTarget)) fs.rmSync(mainTarget, { recursive: true, force: true });
		fs.renameSync(mainSource, mainTarget);
	}

	const stringReplacements: Array<[string | RegExp, string]> = [
		["patchright-core", "patchwright-core"],
		["playwright-core", "patchwright-core"],
		["patchright", "patchwright"],
		["Patchright", "Patchwright"],
		["PATCHRIGHT", "PATCHWRIGHT"],
	];

	// 2. Update patchwright-core files
	if (fs.existsSync(coreTarget)) {
		console.log(`[patchwright_rebranding] Updating patchwright-core manifests and files...`);
		replaceInDir(coreTarget, stringReplacements);

		const corePkgPath = path.join(coreTarget, "package.json");
		if (fs.existsSync(corePkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
			pkg.name = "patchwright-core";
			// PATCHWRIGHT_VERSION lets a build be re-released while the upstream Playwright
			// version is unchanged (e.g. 1.65.2-pw.1 for a fixed build against Playwright 1.65.1).
			if (process.env.PATCHWRIGHT_VERSION) pkg.version = process.env.PATCHWRIGHT_VERSION;
			pkg.description = "A high-level API to automate web browsers with undetectable patches.";
			if (pkg.bin) {
				const binScript = pkg.bin.patchright || pkg.bin.playwright || pkg.bin["patchwright-core"] || "./cli.js";
				pkg.bin = { patchwright: binScript };
			}
			fs.writeFileSync(corePkgPath, JSON.stringify(pkg, null, 2), "utf8");
		}
	}

	// 3. Update patchwright main package files
	if (fs.existsSync(mainTarget)) {
		console.log(`[patchwright_rebranding] Updating patchwright manifests and files...`);
		replaceInDir(mainTarget, stringReplacements);

		const mainPkgPath = path.join(mainTarget, "package.json");
		if (fs.existsSync(mainPkgPath)) {
			const pkg = JSON.parse(fs.readFileSync(mainPkgPath, "utf8"));
			pkg.name = "patchwright";
			pkg.description = "Undetected and patched version of Playwright testing and automation framework.";
			if (process.env.PATCHWRIGHT_VERSION) pkg.version = process.env.PATCHWRIGHT_VERSION;
			if (pkg.bin) {
				const binScript = pkg.bin.patchright || pkg.bin.playwright || "./cli.js";
				pkg.bin = { patchwright: binScript };
			}
			if (pkg.dependencies) {
				const coreVersion = pkg.dependencies["patchright-core"] || pkg.dependencies["playwright-core"] || pkg.version;
				delete pkg.dependencies["patchright-core"];
				delete pkg.dependencies["playwright-core"];
				pkg.dependencies["patchwright-core"] = coreVersion;
			}
			fs.writeFileSync(mainPkgPath, JSON.stringify(pkg, null, 2), "utf8");
		}
	}

	console.log("[patchwright_rebranding] Rebranding to Patchwright completed successfully!");
}

rebrandToPatchwright();
