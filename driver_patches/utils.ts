import type { SourceFile } from "ts-morph";

export function assertDefined<T>(value: T | undefined | null, name?: string): T {
	if (value == null) throw new Error(`Required value${name ? ` "${name}"` : ""} is null or undefined`);
	return value;
}

/**
 * Applies an exact string replacement to upstream Playwright source and fails loudly if the
 * target text is absent. A silently no-op'd replacement would ship an unpatched build against
 * an updated upstream, so every textual patch target must be verified at application time.
 */
export function replaceRequired(text: string, searchValue: string, replaceValue: string, label: string): string {
	if (!text.includes(searchValue))
		throw new Error(
			`Patchwright patch target not found (${label}): ${JSON.stringify(searchValue)} — upstream Playwright source changed?`,
		);
	return text.replace(searchValue, replaceValue);
}

/**
 * Applies many exact string replacements to one upstream source file and fails loudly,
 * listing every target that no longer exists (e.g. after a Playwright version bump).
 */
export function applyReplacements(sourceFile: SourceFile, replacements: Array<[string, string]>, label: string) {
	let text = sourceFile.getText();
	const missing = replacements.filter(([searchValue]) => !text.includes(searchValue));
	if (missing.length > 0)
		throw new Error(
			`Patchwright patch targets not found in ${label} (upstream Playwright source changed?):\n` +
				missing.map(([searchValue]) => `  - ${JSON.stringify(searchValue)}`).join("\n"),
		);
	for (const [searchValue, replaceValue] of replacements) text = text.split(searchValue).join(replaceValue);
	sourceFile.replaceWithText(text);
}
