#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_DIR="$PROJECT_DIR/android-sdk"

source "$PROJECT_DIR/scripts/java_env.sh"
require_java_17
export ANDROID_HOME="$SDK_DIR"
export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"

"$PROJECT_DIR/gradlew" testDevDebugUnitTest "$@"
