#!/bin/bash

set_java_home() {
    if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
        return
    fi

    if ! command -v javac >/dev/null 2>&1; then
        echo "JDK 17+ is required, but javac was not found. Set JAVA_HOME or install a JDK." >&2
        exit 1
    fi

    local javac_path
    javac_path="$(readlink -f "$(command -v javac)")"
    JAVA_HOME="$(cd "$(dirname "$javac_path")/.." && pwd)"
    export JAVA_HOME
}

require_java_17() {
    set_java_home

    local version
    version="$("$JAVA_HOME/bin/javac" -version 2>&1 | awk '{print $2}')"
    local major="${version%%.*}"
    if [ "$major" = "1" ]; then
        major="$(echo "$version" | cut -d. -f2)"
    fi

    if [ "${major:-0}" -lt 17 ]; then
        echo "JDK 17+ is required, but JAVA_HOME points to javac $version." >&2
        exit 1
    fi
}
