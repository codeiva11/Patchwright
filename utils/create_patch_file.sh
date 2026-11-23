#!/usr/bin/env bash
# Writes patchwright.patch by diffing ./playwright_not_patched (unpatched copy) against ./playwright (patched).
# Shared by the PR build and the main updater so both produce byte-identical patch files.
set -euo pipefail

# diff paths must read playwright/... and patchwright/..., so swap the directories while diffing.
mv playwright patchwright
mv playwright_not_patched playwright

echo "# NOTE: This patch file is generated automatically and is not used, it is only for documentation. The driver is actually patched using [patchwright_driver_patch](https://github.com/Kaliiiiiiiiii-Vinyzu/patchwright/blob/main/patchwright_driver_patch.ts), see [the workflow](https://github.com/Kaliiiiiiiiii-Vinyzu/patchwright/blob/main/.github/workflows/patch_file_updater.yml)" >patchwright.patch
diff -ruN -x protocol.yml --minimal playwright patchwright | sed -E 's/^(---|\+\+\+) .*/\1/' >>patchwright.patch || true

rm -rf playwright
mv patchwright playwright
