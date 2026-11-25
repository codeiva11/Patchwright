import { type Node, type Project, SyntaxKind } from "ts-morph";
import { applyReplacements, assertDefined } from "./utils.ts";

// -------------------------------------------------
// server/browserType.ts
// (automatic system-browser installation)
// -------------------------------------------------
// When a machine has no official system browser installed (Brave / Google Chrome /
// Chromium), Patchwright installs one automatically before launching:
//   Windows : winget (user scope first) -> official Brave/Chrome installers
//   macOS   : Homebrew cask -> official Brave dmg (hdiutil)
//   Linux   : Flatpak user install (no root) -> official Brave install script /
//             Chrome deb|rpm -> distro chromium packages (sudo -n only)
// Opt out with PATCHWRIGHT_AUTO_INSTALL=0. Every step fails loudly; if nothing
// can be installed the original instructive error is still thrown.
export function patchAutoInstall(project: Project) {
	const browserTypeSourceFile = project.addSourceFileAtPath("packages/playwright-core/src/server/browserType.ts");

	// 1) child_process import for the installer helpers.
	applyReplacements(
		browserTypeSourceFile,
		[["import path from 'path';", "import path from 'path';\nimport { execFile as patchwrightExecFile } from 'child_process';"]],
		"server/browserType.ts (child_process import)",
	);

	// 2) Additional scan candidates that auto-installers may populate:
	//    Flatpak user/system exports on Linux, ~/Applications on macOS.
	//    (AST-based: browserTypePatch injects the candidates function with mixed
	//    indentation, so exact-text matching is too fragile here.)
	const candidatesFn = browserTypeSourceFile.getFunctionOrThrow("patchwrightSystemBrowserCandidates");
	const platformIfs = candidatesFn.getDescendantsOfKind(SyntaxKind.IfStatement);
	const darwinIf = assertDefined(
		platformIfs.find(ifStatement => ifStatement.getExpression().getText() === "process.platform === 'darwin'"),
		"darwin platform branch of system browser candidates",
	);
	const findPush = (scope: Node) =>
		assertDefined(
			scope
				.getDescendantsOfKind(SyntaxKind.CallExpression)
				.find(call => call.getExpression().getText() === "candidates.push"),
			"candidates.push(...) call",
		);
	const darwinPush = findPush(darwinIf);
	darwinPush.addArgument("path.join(os.homedir(), 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser')");
	darwinPush.addArgument("path.join(os.homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')");
	darwinPush.addArgument("path.join(os.homedir(), 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')");
	// Patchwright: Flatpak user/system installs expose launchers on Linux.
	const linuxElse = assertDefined(darwinIf.getElseStatement(), "linux platform branch of system browser candidates");
	const linuxPush = findPush(linuxElse);
	linuxPush.addArgument("path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'bin', 'com.brave.Browser')");
	linuxPush.addArgument("'/var/lib/flatpak/exports/bin/com.brave.Browser'");
	linuxPush.addArgument("path.join(os.homedir(), '.local', 'share', 'flatpak', 'exports', 'bin', 'com.google.Chrome')");
	linuxPush.addArgument("'/var/lib/flatpak/exports/bin/com.google.Chrome'");

	// 3) Replace the hard "no browser found" error with an automatic installation
	//    attempt, falling back to the original error when installation is not possible.
	const notFoundThrow = assertDefined(
		browserTypeSourceFile
			.getDescendantsOfKind(SyntaxKind.ThrowStatement)
			.find(throwStatement => throwStatement.getText().includes("Patchwright: no official system browser found")),
		"no-system-browser found throw statement",
	);
	const launchBlock = notFoundThrow.getParentIfKindOrThrow(SyntaxKind.Block);
	launchBlock.insertStatements(
		launchBlock.getStatements().indexOf(notFoundThrow),
		`
		// Patchwright: no system browser installed - install one automatically
		// (Brave -> Chrome -> Chromium) so a clean machine works out of the box.
		// Opt out with PATCHWRIGHT_AUTO_INSTALL=0.
		if (process.env.PATCHWRIGHT_AUTO_INSTALL !== '0') {
			const installedCandidate = await patchwrightAutoInstallSystemBrowser();
			if (installedCandidate) return installedCandidate;
		}
	`,
	);

	// 4) Append the installer helpers at module scope.
	browserTypeSourceFile.addStatements(/* ts */ `
// ---------------------------------------------------------------------------
// Patchwright: automatic system-browser installation. Runs only when no
// official system browser exists on the machine and PATCHWRIGHT_AUTO_INSTALL
// is not '0'. Installs Brave (preferred) or Google Chrome from official
// sources only - no third-party mirrors, no Chrome-for-Testing builds.
// ---------------------------------------------------------------------------

async function patchwrightRunCommand(file: string, args: string[], timeoutMs = 900000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return await new Promise<{ ok: boolean; stdout: string; stderr: string }>(resolve => {
    try {
      patchwrightExecFile(file, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: String(error) });
    }
  });
}

async function patchwrightDownloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(\`download failed: \${url} -> HTTP \${response.status}\`);
  fs.writeFileSync(destPath, Buffer.from(await response.arrayBuffer()));
}

async function patchwrightAutoInstallSystemBrowser(): Promise<string | undefined> {
  console.log('Patchwright: no system browser found - attempting automatic installation (Brave / Google Chrome)...');
  try {
    if (process.platform === 'win32') {
      // Prefer the Windows Package Manager (handles silent + user scope cleanly).
      const winget = await patchwrightRunCommand('winget', ['--version'], 15000);
      if (winget.ok) {
        for (const id of ['Brave.Brave', 'Google.Chrome']) {
          for (const extra of [['--scope', 'user'], []]) {
            const result = await patchwrightRunCommand('winget', ['install', '--id', id, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements', ...extra]);
            if (result.ok) break;
          }
          if (await patchwrightSystemBrowserInstalled()) break;
        }
      } else {
        // No winget: official per-user installers directly from the vendors.
        if (!await patchwrightSystemBrowserInstalled()) {
          const braveInstaller = path.join(os.tmpdir(), 'patchwright-brave-installer.exe');
          await patchwrightDownloadFile('https://laptop-updates.brave.com/latest/winx64', braveInstaller);
          await patchwrightRunCommand(braveInstaller, ['--do-not-launch-chrome']);
        }
        if (!await patchwrightSystemBrowserInstalled()) {
          const chromeInstaller = path.join(os.tmpdir(), 'patchwright-chrome-installer.msi');
          await patchwrightDownloadFile('https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi', chromeInstaller);
          await patchwrightRunCommand('msiexec', ['/i', chromeInstaller, '/qn', '/norestart']);
        }
      }
    } else if (process.platform === 'darwin') {
      // Homebrew first; otherwise mount the official Brave dmg and copy the app.
      const brew = await patchwrightRunCommand('brew', ['--version'], 15000);
      if (brew.ok) {
        for (const cask of ['brave-browser', 'google-chrome']) {
          const result = await patchwrightRunCommand('brew', ['install', '--cask', cask]);
          if (result.ok || await patchwrightSystemBrowserInstalled()) break;
        }
      } else {
        const arch = process.arch === 'arm64' ? 'osx-arm64' : 'osx';
        const dmgPath = path.join(os.tmpdir(), 'patchwright-brave.dmg');
        await patchwrightDownloadFile(\`https://laptop-updates.brave.com/latest/\${arch}\`, dmgPath);
        const mount = await patchwrightRunCommand('hdiutil', ['attach', dmgPath, '-nobrowse', '-quiet'], 120000);
        const volume = mount.ok ? fs.readdirSync('/Volumes').find(name => name.startsWith('Brave Browser')) : undefined;
        if (volume) {
          await patchwrightRunCommand('cp', ['-R', \`\${path.join('/Volumes', volume, 'Brave Browser.app')}\`, '/Applications/'], 300000);
          await patchwrightRunCommand('hdiutil', ['detach', path.join('/Volumes', volume)], 60000);
        }
      }
    } else {
      // Linux: Flatpak user installs need no root; native packages then require
      // passwordless sudo - a password prompt would hang the launch pipeline.
      const flatpak = await patchwrightRunCommand('flatpak', ['--version'], 15000);
      if (flatpak.ok) {
        for (const id of ['com.brave.Browser', 'com.google.Chrome']) {
          const result = await patchwrightRunCommand('flatpak', ['install', '--user', '--noninteractive', '-y', id]);
          if (result.ok || await patchwrightSystemBrowserInstalled()) break;
        }
      }
      if (!await patchwrightSystemBrowserInstalled()) {
        const sudoOk = (await patchwrightRunCommand('sudo', ['-n', 'true'], 10000)).ok;
        const sudo = sudoOk ? ['sudo', '-n'] : [];
        const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
        const braveScript = path.join(os.tmpdir(), 'patchwright-brave-install.sh');
        const chromeDeb = path.join(os.tmpdir(), 'google-chrome-stable_current_amd64.deb');
        const chromeRpm = path.join(os.tmpdir(), 'google-chrome-stable_current_x86_64.rpm');
        const attempts: Array<{ file: string; args: string[] }> = sudoOk ? [
          { file: 'sh', args: ['-c', \`curl -fsSL https://dl.brave.com/install.sh | \${sudoOk ? 'sudo -n ' : ''}sh -s --\`] },
          { file: 'sh', args: ['-c', \`curl -fsSL https://dl.brave.com/install.sh | \${sudoOk ? 'sudo -n ' : ''}sh\`] },
          { file: sudo[0] || 'apt-get', args: sudoOk ? [...sudo.slice(1), 'apt-get', 'install', '-y', 'chromium'] : ['install', '-y', 'chromium'] },
          { file: sudo[0] || 'dnf', args: sudoOk ? [...sudo.slice(1), 'dnf', 'install', '-y', 'chromium'] : ['install', '-y', 'chromium'] },
          { file: sudo[0] || 'pacman', args: sudoOk ? [...sudo.slice(1), 'pacman', '-S', '--noconfirm', 'chromium'] : ['-S', '--noconfirm', 'chromium'] },
        ] : [];
        for (const attempt of attempts) {
          await patchwrightRunCommand(attempt.file, attempt.args);
          if (await patchwrightSystemBrowserInstalled()) break;
        }
        if (!await patchwrightSystemBrowserInstalled() && sudoOk) {
          // Official Google Chrome deb/rpm as the final native-package fallback.
          if (fs.existsSync('/usr/bin/apt-get') || fs.existsSync('/usr/bin/dpkg')) {
            await patchwrightDownloadFile(\`https://dl.google.com/linux/direct/google-chrome-stable_current_\${arch}.deb\`, chromeDeb);
            await patchwrightRunCommand('sudo', ['-n', 'apt-get', 'install', '-y', chromeDeb]);
          } else {
            await patchwrightDownloadFile('https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm', chromeRpm);
            await patchwrightRunCommand('sudo', ['-n', 'dnf', 'install', '-y', chromeRpm]);
          }
        }
      }
    }
  } catch (error) {
    console.log('Patchwright: automatic browser installation failed:', String(error));
  }
  // Re-scan: return the first system browser that now exists.
  for (const candidate of patchwrightSystemBrowserCandidates()) {
    if (await existsAsync(candidate)) return candidate;
  }
  console.log('Patchwright: automatic installation did not produce a usable system browser.');
  return undefined;
}

async function patchwrightSystemBrowserInstalled(): Promise<boolean> {
  for (const candidate of patchwrightSystemBrowserCandidates()) {
    if (await existsAsync(candidate)) return true;
  }
  return false;
}
`);
}
