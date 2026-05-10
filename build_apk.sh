#!/bin/bash
set -e

PROJECT_DIR="$(pwd)"
CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-10406996_latest.zip"

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}=== Pomo Lightweight Builder ===${NC}"

source "$PROJECT_DIR/scripts/java_env.sh"
require_java_17

# Check if ANDROID_HOME is already set and valid
if [ -n "$ANDROID_HOME" ] && [ -d "$ANDROID_HOME/platforms" ]; then
    echo "Using system Android SDK at: $ANDROID_HOME"
    SDK_DIR="$ANDROID_HOME"
else
    echo "No system Android SDK found, using local SDK..."
    SDK_DIR="$PROJECT_DIR/android-sdk"
    
    mkdir -p "$SDK_DIR/cmdline-tools"
    
    if [ ! -f "$SDK_DIR/cmdline-tools/latest/bin/sdkmanager" ]; then
        echo "Downloading Android Command Line Tools..."
        wget -q --show-progress -O tools.zip "$CMDLINE_TOOLS_URL"
        unzip -q tools.zip -d "$SDK_DIR/cmdline-tools"
        mv "$SDK_DIR/cmdline-tools/cmdline-tools" "$SDK_DIR/cmdline-tools/latest"
        rm -f tools.zip
    fi
    
    export ANDROID_HOME="$SDK_DIR"
    export PATH="$SDK_DIR/cmdline-tools/latest/bin:$SDK_DIR/platform-tools:$PATH"
    
    if [ ! -d "$SDK_DIR/platforms/android-34" ]; then
        echo "Installing SDK components..."
        yes | sdkmanager --licenses > /dev/null 2>&1
        sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
    fi
fi

echo -e "${GREEN}Building dev APK...${NC}"
"$PROJECT_DIR/gradlew" assembleDevDebug

APK_PATH="$PROJECT_DIR/app/build/outputs/apk/dev/debug/app-dev-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo -e "${GREEN}Build Success!${NC}"
    echo "APK location: $APK_PATH"
    
    if command -v adb &> /dev/null; then
        if adb get-state 1>/dev/null 2>&1; then
            echo "Installing to connected device..."
            adb install -r "$APK_PATH"
            echo "Installed!"
        fi
    fi
else
    echo "Build failed. Check output above."
fi
