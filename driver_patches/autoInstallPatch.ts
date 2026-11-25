import { type Node, type Project, SyntaxKind } from "ts-morph";
import { applyReplacements, assertDefined } from "./utils.ts";

// -------------------------------------------------
// server/browserType.ts
// (automatic system-browser installation)
// -------------------------------------------------
// When a machine has no official system browser installed (Brave / Google Chrome /
// Chromium), Patchwright installs one automatically before launching:
//   Windows : winget (user scope first) -> official Brave/Chrome installers,
//             Authenticode-signature verified before execution
//   macOS   : Homebrew cask -> official Brave dmg (hdiutil), codesign-verified
//   Linux   : Flatpak user install (no root) -> official Brave apt/dnf repo
//             (GPG-verified packages) -> Chrome deb|rpm -> distro chromium
// Hardening:
//   - Single-flight: concurrent launches share ONE installation attempt.
//   - Attempt-once: a failed attempt is remembered for the process lifetime, so
//     relaunches fail fast instead of hanging on the network again.
//   - Downloaded installers are signature-verified before they are executed.
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
	//    Flatpak user/system exports on Linux, ~/Applications on macOS,
	//    /usr/local/bin on Linux.
	//    (AST-based: browserTypePatch injects the candidates function with mixed
	//    indentation, so exact-text matching is too fragile here.)
	const candidatesFn = browserTypeSourceFile.getFunctionOrThrow("patchwrightSystemBrowserCandidates");
	const platformIfs = candidatesFn.getDescendantsOfKind(SyntaxKind.IfStatement);
	const darwinIf = assertDefined(
		platformIfs.find(ifStatement => ifStatement.getExpression().getText() === "process.platform === 'darwin'"),
		"darwin platform branch of system browser candidates",
	);
	const findPush = (scope: import("ts-morph").Node) =>
		assertDefined(
			scope
				.getDescendantsOfKind(SyntaxKind.CallExpression)
				.find((call: import("ts-morph").CallExpression) => call.getExpression().getText() === "candidates.push"),
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
	linuxPush.addArgument("'/usr/local/bin/brave-browser'");
	linuxPush.addArgument("'/usr/local/bin/google-chrome-stable'");
	linuxPush.addArgument("'/usr/local/bin/chromium'");

	// 3) Replace the hard "no browser found" error with an automatic installation
	//    attempt, falling back to the original error when installation is not possible.
	//    Done as an exact-TEXT replacement on the throw injected by browserTypePatch:
	//    AST insertStatements proved position-unreliable here (it landed at the block
	//    top and would have run auto-install on every launch, before the scan).
	applyReplacements(
		browserTypeSourceFile,
		[[
			"\t\t\tthrow new Error('Patchwright: no official system browser found (Google Chrome, Chromium or Brave). Install one of these browsers, or point PATCHWRIGHT_BINARY at a browser executable.');",
			"\t\t\t// Patchwright: the scan found nothing - install one automatically\n" +
				"\t\t\t// (Chrome -> Chromium -> Brave) so a clean machine works out of the box.\n" +
				"\t\t\t// Opt out with PATCHWRIGHT_AUTO_INSTALL=0.\n" +
				"\t\t\tif (process.env.PATCHWRIGHT_AUTO_INSTALL !== '0') {\n" +
					"\t\t\t\tconst installedCandidate = await patchwrightAutoInstallSystemBrowser();\n" +
					"\t\t\t\tif (installedCandidate) return installedCandidate;\n" +
					"\t\t\t}\n" +
					"\t\t\tthrow new Error('Patchwright: no official system browser found (Google Chrome, Chromium or Brave). Install one of these browsers, or point PATCHWRIGHT_BINARY at a browser executable.');",
		]],
		"server/browserType.ts (auto-install before the no-browser throw)",
	);

	// 4) Append the installer helpers at module scope.
	browserTypeSourceFile.addStatements(/* ts */ `
// ---------------------------------------------------------------------------
// Patchwright: automatic system-browser installation. Runs only when no
// official system browser exists on the machine and PATCHWRIGHT_AUTO_INSTALL
// is not '0'. Installs Google Chrome (preferred) or Brave from official
// sources only - no third-party mirrors, no Chrome-for-Testing builds.
// Hardened: single-flight (concurrent launches share one attempt), attempt
// once per process, and signature-verified installers.
// ---------------------------------------------------------------------------

let patchwrightInstallAttempt: Promise<string | undefined> | undefined = false as any;

async function patchwrightRunCommand(file: string, args: string[], timeoutMs = 600000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
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

// Verify that a downloaded Windows installer carries a valid Authenticode
// signature from a trusted publisher. Returns true only for signed binaries;
// unsigned or tampered installers are rejected before they are ever executed.
async function patchwrightVerifyWindowsSignature(filePath: string): Promise<boolean> {
  const psScript = "(($s = Get-AuthenticodeSignature -LiteralPath '" + filePath.replace(/'/g, "''") + "').Status -eq 'Valid') -and ($s.SignerCertificate.Subject -match 'Brave Software|Google LLC')";
  const result = await patchwrightRunCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], 120000);
  return result.ok && /True/.test(result.stdout);
}

async function patchwrightSystemBrowserInstalled(): Promise<boolean> {
  for (const candidate of patchwrightSystemBrowserCandidates()) {
    if (await existsAsync(candidate)) return true;
  }
  return false;
}

// Single-flight entry point: all concurrent launches awaiting installation share
// exactly ONE attempt per driver process, and a failed attempt is never retried
// (relaunches fail fast with the instructive error instead of hanging again).
async function patchwrightAutoInstallSystemBrowser(): Promise<string | undefined> {
  if (patchwrightInstallAttempt) return await patchwrightInstallAttempt;
  patchwrightInstallAttempt = (async () => {
    console.log('Patchwright: no system browser found - attempting automatic installation (Google Chrome / Brave)...');
    try {
      if (process.platform === 'win32') {
        // Prefer the Windows Package Manager (handles silent + user scope cleanly,
        // and verifies packages against signed winget manifests).
        const winget = await patchwrightRunCommand('winget', ['--version'], 15000);
        if (winget.ok) {
          for (const id of ['Google.Chrome', 'Brave.Brave']) {
            for (const extra of [['--scope', 'user'], []]) {
              const result = await patchwrightRunCommand('winget', ['install', '--id', id, '-e', '--silent', '--accept-source-agreements', '--accept-package-agreements', ...extra]);
              if (result.ok) break;
            }
            if (await patchwrightSystemBrowserInstalled()) break;
          }
        } else {
          // No winget: official per-user installers directly from the vendors,
          // executed only after their Authenticode signature validates. Chrome
          // first so the default launch identity stays Google Chrome.
          if (!await patchwrightSystemBrowserInstalled()) {
            const chromeInstaller = path.join(os.tmpdir(), 'patchwright-chrome-installer.msi');
            await patchwrightDownloadFile('https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi', chromeInstaller);
            if (await patchwrightVerifyWindowsSignature(chromeInstaller))
              await patchwrightRunCommand('msiexec', ['/i', chromeInstaller, '/qn', '/norestart']);
            else
              console.log('Patchwright: Chrome installer signature check failed - skipping it.');
          }
          if (!await patchwrightSystemBrowserInstalled()) {
            const braveInstaller = path.join(os.tmpdir(), 'patchwright-brave-installer.exe');
            await patchwrightDownloadFile('https://laptop-updates.brave.com/latest/winx64', braveInstaller);
            if (await patchwrightVerifyWindowsSignature(braveInstaller))
              await patchwrightRunCommand(braveInstaller, ['--do-not-launch-chrome']);
            else
              console.log('Patchwright: Brave installer signature check failed - skipping it.');
          }
        }
      } else if (process.platform === 'darwin') {
        // Homebrew first (formulae/casks are checksum-verified by brew itself).
        const brew = await patchwrightRunCommand('brew', ['--version'], 15000);
        if (brew.ok) {
          for (const cask of ['google-chrome', 'brave-browser']) {
            const result = await patchwrightRunCommand('brew', ['install', '--cask', cask]);
            if (result.ok || await patchwrightSystemBrowserInstalled()) break;
          }
        } else {
          // Mount the official Brave dmg, verify the app's code signature and
          // Gatekeeper assessment before copying it into /Applications.
          const arch = process.arch === 'arm64' ? 'osx-arm64' : 'osx';
          const dmgPath = path.join(os.tmpdir(), 'patchwright-brave.dmg');
          await patchwrightDownloadFile(\`https://laptop-updates.brave.com/latest/\${arch}\`, dmgPath);
          const mount = await patchwrightRunCommand('hdiutil', ['attach', dmgPath, '-nobrowse', '-quiet'], 120000);
          const volume = mount.ok ? fs.readdirSync('/Volumes').find(name => name.startsWith('Brave Browser')) : undefined;
          if (volume) {
            const appPath = \`\${path.join('/Volumes', volume, 'Brave Browser.app')}\`;
            if (await patchwrightVerifyMacApp(appPath))
              await patchwrightRunCommand('cp', ['-R', appPath, '/Applications/'], 300000);
            else
              console.log('Patchwright: Brave.app code signature check failed - skipping it.');
            await patchwrightRunCommand('hdiutil', ['detach', path.join('/Volumes', volume)], 60000);
          }
        }
      } else {
        // Linux: Flatpak user installs need no root and are verified by Flathub.
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
          // Official Brave APT/DNF repository setup (GPG-verified packages) - no
          // curl-pipe-to-shell execution. Then Google Chrome and distro chromium.
          const attempts: Array<{ file: string; args: string[] }> = [];
          if (sudoOk && fs.existsSync('/usr/bin/apt-get')) {
            attempts.push(
              { file: 'sh', args: ['-c',
                'curl -fsSL https://brave-browser-apt-release.s3.brave.com/brave-core.asc | ' +
                'sudo -n gpg --dearmor -o /usr/share/keyrings/brave-browser-archive-keyring.gpg && ' +
                'echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" | ' +
                'sudo -n tee /etc/apt/sources.list.d/brave-browser-release.list >/dev/null && ' +
                'sudo -n apt-get update -qq && sudo -n apt-get install -y brave-browser'] },
              { file: 'sudo', args: ['-n', 'apt-get', 'install', '-y', 'chromium'] },
            );
            if (arch === 'amd64') {
              const chromeDeb = path.join(os.tmpdir(), 'google-chrome-stable_current_amd64.deb');
              attempts.push({ file: 'sh', args: ['-c',
                \`curl -fsSL -o '\${chromeDeb}' https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo -n apt-get install -y '\${chromeDeb}'\`] });
            }
          } else if (sudoOk && (fs.existsSync('/usr/bin/dnf') || fs.existsSync('/usr/bin/yum'))) {
            attempts.push(
              { file: 'sudo', args: ['-n', 'dnf', 'install', '-y', 'chromium'] },
              { file: 'sh', args: ['-c',
                'curl -fsSL -o /tmp/google-chrome-stable_current_x86_64.rpm ' +
                'https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm && ' +
                'sudo -n dnf install -y /tmp/google-chrome-stable_current_x86_64.rpm'] },
            );
          } else if (sudoOk && fs.existsSync('/usr/bin/pacman')) {
            attempts.push({ file: 'sudo', args: ['-n', 'pacman', '-S', '--noconfirm', 'chromium'] });
          }
          for (const attempt of attempts) {
            await patchwrightRunCommand(attempt.file, attempt.args);
            if (await patchwrightSystemBrowserInstalled()) break;
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
    console.log('Patchwright: automatic installation did not produce a usable system browser (will not retry in this process).');
    return undefined;
  })();
  const result = await patchwrightInstallAttempt;
  if (!result) {
    // Failed attempt: subsequent launches must not retry (fail fast instead).
    return result;
  }
  return result;
}
`);
}
