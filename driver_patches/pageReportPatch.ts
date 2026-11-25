import { type Project } from "ts-morph";
import { replaceRequired } from "./utils.ts";

// Page initialization saves a globals snapshot in the main world. A popup may
// open a dialog before that snapshot runs, so awaiting the snapshot in a popup
// deadlocks the renderer and hides both the page and its dialog. Popups do not
// need this snapshot; skipping it also avoids leaving an unresolved protocol
// call behind when a popup closes with a dialog still open.
export function patchPageReport(project: Project) {
	const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/page.ts");
	const text = replaceRequired(
		sourceFile.getFullText(),
		"await this.safeNonStallingEvaluateInAllFrames(saveGlobalsSnapshotSource, 'main');",
		"if (!opener)\n      await this.safeNonStallingEvaluateInAllFrames(saveGlobalsSnapshotSource, 'main');",
		"page.ts reportAsNew snapshot await",
	);
	sourceFile.replaceWithText(text);
}
