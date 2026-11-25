import { type Project } from "ts-morph";
import { replaceRequired } from "./utils.ts";

// Page initialization saves a globals snapshot in the main world. A popup may
// open a dialog before that snapshot runs; awaiting the snapshot deadlocks the
// renderer and hides both the page and its dialog. Report the page first and
// let the snapshot complete after the dialog is handled.
export function patchPageReport(project: Project) {
	const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/page.ts");
	const text = replaceRequired(
		sourceFile.getFullText(),
		"await this.safeNonStallingEvaluateInAllFrames(saveGlobalsSnapshotSource, 'main');",
		"void this.safeNonStallingEvaluateInAllFrames(saveGlobalsSnapshotSource, 'main').catch(() => {});",
		"page.ts reportAsNew snapshot await",
	);
	sourceFile.replaceWithText(text);
}
