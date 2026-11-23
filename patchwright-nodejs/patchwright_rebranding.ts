import * as fs from "fs";
import * as path from "path";
import {
	IndentationText,
	type MethodSignature,
	Project,
	type SourceFile,
	SyntaxKind,
} from "ts-morph";



function addIsolatedContextParameter(typesSourceFile: SourceFile, interfaceName: string, methodNames: string[]): void {
	const targetInterface = typesSourceFile.getInterface(interfaceName)!;
	const evaluateSignatures = targetInterface
		.getMembers()
		.filter(
			(member): member is MethodSignature =>
				member.isKind(SyntaxKind.MethodSignature) && methodNames.includes(member.getName()),
		);

	evaluateSignatures.forEach(method => {
		method.addParameter({
			name: "isolatedContext",
			type: "boolean",
			hasQuestionToken: true,
		});
	});
}

function patchTypesDeclarations(): void {
	const project = new Project({
		manipulationSettings: {
			indentationText: IndentationText.TwoSpaces,
		},
	});

	const typesSourceFile = project.addSourceFileAtPath("packages/playwright-core/types/types.d.ts");
	addIsolatedContextParameter(typesSourceFile, "Page", ["evaluate", "evaluateHandle"]);
	addIsolatedContextParameter(typesSourceFile, "Worker", ["evaluate", "evaluateHandle"]);
	addIsolatedContextParameter(typesSourceFile, "Frame", ["evaluate", "evaluateHandle", "evaluateAll"]);
	addIsolatedContextParameter(typesSourceFile, "Locator", ["evaluate", "evaluateHandle"]);
	addIsolatedContextParameter(typesSourceFile, "JSHandle", ["evaluate", "evaluateHandle"]);

	project.saveSync();
}

function getAllJsTsFiles(dir: string): string[] {
	let results: string[] = [];
	const list = fs.readdirSync(dir);

	list.forEach((file: string) => {
		const filePath = path.join(dir, file);
		const stat = fs.statSync(filePath);

		if (stat && stat.isDirectory()) {
			results = results.concat(getAllJsTsFiles(filePath));
		} else if (filePath.endsWith(".ts") || filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
			results.push(filePath);
		}
	});

	return results;
}

function renameImportsAndExportsInDirectory(directoryPath: string): void {
	const project = new Project();
	const jsTsFiles = getAllJsTsFiles(directoryPath);

	jsTsFiles.forEach(filePath => {
		const sourceFile = project.addSourceFileAtPath(filePath);
		let modified = false;

		sourceFile.getImportDeclarations().forEach(importDecl => {
			const moduleSpecifierValue = importDecl.getModuleSpecifierValue();

			if (moduleSpecifierValue.startsWith("playwright-core")) {
				const newModuleSpecifier = moduleSpecifierValue.replace("playwright-core", "patchwright-core");
				importDecl.setModuleSpecifier(newModuleSpecifier);
				modified = true;
			} else if (moduleSpecifierValue.includes("playwright-core")) {
				const newModuleSpecifier = moduleSpecifierValue.replace(/playwright-core/g, "patchwright-core");
				importDecl.setModuleSpecifier(newModuleSpecifier);
				modified = true;
			}
		});

		sourceFile.getExportDeclarations().forEach(exportDecl => {
			const moduleSpecifierValue = exportDecl.getModuleSpecifierValue();

			if (moduleSpecifierValue && moduleSpecifierValue.startsWith("playwright-core")) {
				const newModuleSpecifier = moduleSpecifierValue.replace("playwright-core", "patchwright-core");
				exportDecl.setModuleSpecifier(newModuleSpecifier);
				modified = true;
			}
		});

		const exportAllDeclarations = sourceFile.getExportDeclarations().filter(exportDecl => {
			return exportDecl.getModuleSpecifierValue() === "playwright-core";
		});

		exportAllDeclarations.forEach(exportDecl => {
			exportDecl.setModuleSpecifier("patchwright-core");
			modified = true;
		});

		const moduleLoaderCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter(call => {
			const expression = call.getExpression();
			return (
				expression.getText() === "require" ||
				expression.getText() === "require.resolve" ||
				expression.isKind(SyntaxKind.ImportKeyword)
			);
		});

		moduleLoaderCalls.forEach(call => {
			const args = call.getArguments();

			if (args.length && args[0].getText().includes("playwright-core")) {
				const arg = args[0];
				arg.replaceWithText(arg.getText().replace(/playwright-core/g, "patchwright-core"));
				modified = true;
			} else if (args.length && args[0].getText().includes("playwright")) {
				const arg = args[0];
				arg.replaceWithText(arg.getText().replace(/playwright/g, "patchwright"));
				modified = true;
			}
		});

		if (modified) {
			sourceFile.saveSync();
			console.log(`Modified imports/exports in: ${filePath}`);
		}
	});
}

export function patchRebranding(): void {
	patchTypesDeclarations();

	fs.rename("packages/playwright-core", "packages/patchwright-core", (_coreRenameError: unknown) => {
		fs.rename("packages/playwright", "packages/patchwright", (_patchwrightRenameError: unknown) => {
			fs.readFile("../README.md", "utf8", (_readmeError: unknown, data: string) => {
				fs.writeFileSync("packages/patchwright/README.md", data, "utf8");
			});

			fs.writeFileSync(
				"packages/patchwright-core/README.md",
				"# patchwright-core\n\nThis package contains the no-browser flavor of [Patchwright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchwright).",
				"utf8",
			);

			fs.readFile(
				"packages/patchwright-core/package.json",
				"utf8",
				(_corePackageError: unknown, data: string) => {
					const packageJson = JSON.parse(data);
					packageJson.name = "patchwright-core";

					if (process.env.patchwright_release && process.env.patchwright_release.trim() !== "") {
						packageJson.version = process.env.patchwright_release;
					}

					packageJson.author["name"] = "codeiva11";
					packageJson.homepage = "https://github.com/codeiva11/Patchwright";
					packageJson.repository["url"] = "https://github.com/codeiva11/Patchwright";
					packageJson.bin = {
						"patchwright-core": "cli.js",
					};

					const updatedJsonData = JSON.stringify(packageJson, null, 4);
					fs.writeFile(
						"packages/patchwright-core/package.json",
						updatedJsonData,
						"utf8",
						(writeError: unknown) => {
							if (writeError) {
								console.log("Error writing to the file:", writeError);
							} else {
								console.log("JSON file has been updated successfully.");
							}
						},
					);
				},
			);

			fs.readFile("packages/patchwright/package.json", "utf8", (_patchwrightPackageError: unknown, data: string) => {
				const packageJson = JSON.parse(data);
				packageJson.name = "patchwright";

				if (process.env.patchwright_release && process.env.patchwright_release.trim() !== "") {
					packageJson.version = process.env.patchwright_release;
				}

				packageJson.author["name"] = "codeiva11";
				packageJson.homepage = "https://github.com/codeiva11/Patchwright";
				packageJson.repository["url"] = "https://github.com/codeiva11/Patchwright";
				packageJson.bin = {
					patchwright: "cli.js",
				};
				packageJson.dependencies = {
					"patchwright-core": packageJson.version,
				};

				const updatedJsonData = JSON.stringify(packageJson, null, 4);
				fs.writeFile("packages/patchwright/package.json", updatedJsonData, "utf8", (writeError: unknown) => {
					if (writeError) {
						console.log("Error writing to the file:", writeError);
					} else {
						console.log("JSON file has been updated successfully.");
					}
				});
			});

			renameImportsAndExportsInDirectory("packages/patchwright");
		});
	});
}

patchRebranding();
