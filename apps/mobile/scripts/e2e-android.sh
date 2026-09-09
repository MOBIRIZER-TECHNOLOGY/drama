#!/usr/bin/env bash
#
# Run the Maestro flows against a build of the app on a running emulator or device.
#
# The flows drive the installed APK, not a dev bundle, so what they exercise is what a viewer would install.
# They run in order and share state on purpose: 01 completes onboarding, and the rest start from a device
# that has already been through it — which is how a returning viewer arrives.
#
# The app must be installed and pointed at a reachable API:
#
#     scripts/build-android.sh --api http://192.168.1.200:8001 --media http://192.168.1.200:8090
#     adb install -r dist/katha-0.1.0-release.apk
#     scripts/e2e-android.sh
#
# Usage:
#   scripts/e2e-android.sh                       # every flow, in order
#   scripts/e2e-android.sh e2e/02-browse-and-play.yaml
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP_ID="com.mobirizer.katha"

# Maestro is a JVM tool: same JDK the Android build uses, same reason it is not a system install.
has_java() { [ -n "${1:-}" ] && { [ -x "$1/bin/java" ] || [ -x "$1/bin/java.exe" ]; }; }
if ! has_java "${JAVA_HOME:-}"; then
  JAVA_HOME=""
  for candidate in "$HOME/.jdks/temurin-17" "$HOME/.jdks"/jdk-17*; do
    if has_java "$candidate"; then JAVA_HOME="$candidate"; break; fi
  done
fi
if [ -z "${JAVA_HOME:-}" ]; then
  echo "No JDK 17 found — see scripts/build-android.sh for how to unpack one." >&2
  exit 1
fi
export JAVA_HOME

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

MAESTRO="${MAESTRO_BIN:-}"
if [ -z "$MAESTRO" ]; then
  for candidate in "$HOME/.maestro/maestro/bin/maestro.bat" "$HOME/.maestro/maestro/bin/maestro" "$HOME/.maestro/bin/maestro"; do
    if [ -x "$candidate" ] || [ -f "$candidate" ]; then MAESTRO="$candidate"; break; fi
  done
fi
if [ -z "$MAESTRO" ]; then
  cat >&2 <<'MSG'
Maestro is not installed. Unpack it — no installer, no admin rights:

  curl -Lo maestro.zip https://github.com/mobile-dev-inc/maestro/releases/latest/download/maestro.zip
  mkdir -p "$HOME/.maestro" && unzip -q maestro.zip -d "$HOME/.maestro"

Or set MAESTRO_BIN to an existing install.
MSG
  exit 1
fi

if ! adb devices | grep -qE "\sdevice$"; then
  echo "No device or emulator is attached (adb devices is empty)." >&2
  exit 1
fi

if ! adb shell pm list packages | grep -q "$APP_ID"; then
  echo "$APP_ID is not installed. Build and install it first — see the header of this script." >&2
  exit 1
fi

# Maestro phones home about CLI usage unless told not to; a test run should not depend on that.
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

TARGET="${1:-e2e/}"
echo "==> maestro test $TARGET"
"$MAESTRO" test "$TARGET"
