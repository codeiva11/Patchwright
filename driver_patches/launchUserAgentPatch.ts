import { type Project } from "ts-morph";
import { replaceRequired } from "./utils.ts";

const launchHelper = [
	"function patchwrightLaunchUserAgent(executable: string, channel: string | undefined): string | undefined {",
	"  try {",
	"    if (!executable)",
	"      return;",
	"    const output = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim();",
	"    const match = output.match(/(\\d+)\\.(\\d+)\\.(\\d+)\\.(\\d+)/);",
	"    if (!match)",
	"      return;",
	"    const major = match[1];",
	"    const identity = (output + ' ' + (channel || '') + ' ' + executable).toLowerCase();",
	"    const isEdge = identity.includes('edge') || identity.includes('msedge');",
	"    const platform = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';",
	"    let userAgent = 'Mozilla/5.0 (' + platform + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36';",
	"    if (isEdge)",
	"      userAgent += ' Edg/' + major + '.0.0.0';",
	"    return userAgent;",
	"  } catch {",
	"    return;",
	"  }",
	"}",
].join("\n");

// Give every Chromium process a native-shaped default UA before any target
// starts. Service workers read navigator.userAgent from the browser process and
// ignore per-page Network/Emulation overrides, so this is the only launch-time
// fix for that surface.
export function patchLaunchUserAgent(project: Project) {
	const sourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/chromium/chromium.ts");
	let text = sourceFile.getFullText();
	text = replaceRequired(text, "import fs from 'fs';", "import fs from 'fs';\nimport { execFileSync } from 'child_process';", "chromium.ts child_process import");
	text = replaceRequired(text, "const ARTIFACTS_FOLDER", launchHelper + "\n\nconst ARTIFACTS_FOLDER", "chromium.ts launch UA helper");
	text = replaceRequired(
		text,
		"    const chromeArguments = [...chromiumSwitches()];",
		[
			"    const chromeArguments = [...chromiumSwitches()];",
			"    if (process.env.PATCHWRIGHT_SYSTEM_STEALTH !== '0' && !options.userAgent && !args.some(arg => arg.startsWith('--user-agent'))) {",
			"      const launchUserAgent = patchwrightLaunchUserAgent((options as any).executablePath || (options as any).customExecutablePath || this.executablePath(), options.channel);",
			"      if (launchUserAgent)",
			"        chromeArguments.push('--user-agent=' + launchUserAgent);",
			"    }",
		].join("\n"),
		"chromium.ts launch UA switch",
	);
	sourceFile.replaceWithText(text);
}
