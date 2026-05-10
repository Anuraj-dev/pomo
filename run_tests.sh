#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$PROJECT_DIR/scripts/java_env.sh"
require_java_17

# Check if ANDROID_HOME is already set and valid
if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME/platforms" ]; then
    echo "No system Android SDK found, using local SDK..."
    SDK_DIR="$PROJECT_DIR/android-sdk"
    export ANDROID_HOME="$SDK_DIR"
    export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"
fi

"$PROJECT_DIR/gradlew" testDevDebugUnitTest "$@"
