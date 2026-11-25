import { type CallExpression, Node, SyntaxKind } from "ts-morph";

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

export function bumpAssertMaxArguments(call: CallExpression) {
	const countArgument = assertDefined(call.getArguments()[1], "assertMaxArguments count").asKindOrThrow(
		SyntaxKind.NumericLiteral,
	);
	countArgument.setLiteralValue(countArgument.getLiteralValue() + 1);
}

export function addChannelCallProperty(call: CallExpression, name: string, initializer: string) {
	const objectArgument = assertDefined(
		call.getArguments().find(Node.isObjectLiteralExpression),
		"channel call options",
	);
	objectArgument.addPropertyAssignment({ name, initializer });
}
