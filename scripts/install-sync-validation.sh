#!/usr/bin/env bash
set -euo pipefail

apk="${1:-}"
if [[ -z "$apk" || ! -f "$apk" ]]; then
  echo "usage: $0 <app-dev-debug.apk>" >&2
  echo "Installs the packaged Android sync test artifact." >&2
  exit 1
fi

adb install -r -g "$apk"
echo "installed $apk"
echo "start: adb shell am start -n com.pomo/.MainActivity"
echo "Chrome: unzip pomo-sync-test-extension.zip and load the folder unpacked."
