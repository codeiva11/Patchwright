import { type Project } from "ts-morph";
import { applyReplacements } from "./utils.ts";

// -------------------------------------------------
// server/browserType.ts
// (automatic Xvfb display for headed runs on Linux)
// -------------------------------------------------
// A headed launch on a display-less Linux server (no $DISPLAY) fails outright.
// Patchwright now auto-spawns Xvfb on a free display, points the browser at it,
// and tears the virtual display down with the driver process. Opt out with
// PATCHWRIGHT_XVFB=0. Xvfb is already installed by `patchwright-core install-deps`.
export function patchXvfb(project: Project) {
	const browserTypeSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/browserType.ts");

	// Patch the launch pipeline with an exact-text replacement: right after
	// `prepared` is resolved (arguments known) and before the browser process
	// starts, auto-start Xvfb when this is a headful launch without a display.
	applyReplacements(
		browserTypeSourceFile,
		[
			[
				"const prepared = await progress.race(this._prepareToLaunch(options, isPersistent, userDataDir));",
				"const prepared = await progress.race(this._prepareToLaunch(options, isPersistent, userDataDir));\n" +
					"\t// Patchwright: headed launches on display-less Linux servers automatically\n" +
					"\t// get a virtual display (Xvfb), so headful automation works out of the box.\n" +
					"\t// The Xvfb process is torn down together with the driver process. Opt out\n" +
					"\t// with PATCHWRIGHT_XVFB=0.\n" +
					"\tif (process.platform !== 'win32' && process.platform !== 'darwin' && !env.DISPLAY && process.env.PATCHWRIGHT_XVFB !== '0' && !prepared.browserArguments.some(argument => argument === '--headless' || argument.startsWith('--headless='))) {\n" +
					"\t\ttry {\n" +
					"\t\t\tconst display = await patchwrightStartXvfb();\n" +
					"\t\t\tif (display) {\n" +
					"\t\t\t\tenv.DISPLAY = display;\n" +
					"\t\t\t\tconsole.log(`Patchwright: no DISPLAY - started Xvfb on ${display} for this headful launch.`);\n" +
					"\t\t\t}\n" +
					"\t\t} catch (error) {\n" +
					"\t\t\tconsole.log('Patchwright: Xvfb auto-start failed, continuing without a display:', String(error));\n" +
					"\t\t}\n" +
					"\t}",
			],
		],
		"server/browserType.ts (Xvfb auto-start launch hook)",
	);

	// Append the Xvfb lifecycle helpers at module scope.
	browserTypeSourceFile.addStatements(/* ts */ `
// ---------------------------------------------------------------------------
// Patchwright: automatic Xvfb lifecycle for headful launches on Linux.
// Xvfb processes are started on the first free display, tracked here, and
// terminated when the driver process exits.
// ---------------------------------------------------------------------------

const patchwrightXvfbProcesses: Array<{ child: any; display: string }> = [];
let patchwrightXvfbCleanupRegistered = false;

async function patchwrightStartXvfb(): Promise<string | undefined> {
  // Pick a free display: check the lock sockets under /tmp/.X11-unix.
  let display: string | undefined;
  for (let n = 99; n < 120; n++) {
    const candidate = ':' + n;
    const lockPath = path.join('/tmp', '.X11-unix', 'X' + n);
    if (!fs.existsSync(lockPath)) {
      display = candidate;
      break;
    }
  }
  if (!display) return undefined;
  const child = require('child_process').spawn('Xvfb', [display, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], {
    stdio: 'ignore',
    detached: false,
  });
  // If Xvfb is missing or dies immediately, treat the attempt as failed.
  await new Promise(resolve => setTimeout(resolve, 300));
  if (child.exitCode !== null) return undefined;
  child.on('exit', () => {
    const index = patchwrightXvfbProcesses.findIndex(entry => entry.child === child);
    if (index !== -1) patchwrightXvfbProcesses.splice(index, 1);
  });
  patchwrightXvfbProcesses.push({ child, display });
  if (!patchwrightXvfbCleanupRegistered) {
    patchwrightXvfbCleanupRegistered = true;
    process.on('exit', () => {
      for (const entry of patchwrightXvfbProcesses.splice(0)) {
        try { entry.child.kill('SIGTERM'); } catch { }
      }
    });
  }
  return display;
}
`);
}
