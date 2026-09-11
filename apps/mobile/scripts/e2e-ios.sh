#!/usr/bin/env bash
#
# Run the Maestro flows against a release build of the app on a booted iOS simulator.
#
# The iOS twin of e2e-android.sh: the flows drive the installed app, not a dev bundle, so what they exercise
# is what a viewer would install. They run in order and share state on purpose: 01 completes onboarding, and
# the rest start from a device that has already been through it — which is how a returning viewer arrives.
#
# Build and install first. The simulator shares the host's loopback, so the API and media host the stack
# runs on can be named as 127.0.0.1; both are baked into the app (and into its cleartext exceptions) at
# build time:
#
#     xcrun simctl boot "iPhone 17"
#     EXPO_PUBLIC_API_URL=http://127.0.0.1:8001 EXPO_PUBLIC_MEDIA_URL=http://127.0.0.1:8090 \
#       npx expo run:ios --configuration Release --device "iPhone 17" --no-bundler
#     scripts/e2e-ios.sh
#
# Prebuild needs a GoogleService-Info.plist next to app.json (git-ignored). Without Firebase credentials a
# placeholder with the right BUNDLE_ID is enough: the app disables sign-in when the runtime config carries no
# Firebase project, so nothing in it is read.
#
# Usage:
#   scripts/e2e-ios.sh                          # every flow, in order, on the booted simulator
#   scripts/e2e-ios.sh e2e/02-browse-and-play.yaml
#
# A physical iPhone cannot be driven from here: Maestro's iOS support is Xcode simulators only, and it
# answers a real device's UDID with "not connected" however the phone is attached. Hardware is verified
# by hand instead — build and install with `expo run:ios --device <udid>`, launch it, and check it stays
# up (`xcrun devicectl device info processes`). That covers the launch path, which is the part of iOS 27
# that actually differs; the flows below then run on a simulator of the same OS version.
#
# The flows name the series they drive through SERIES_TITLE. Left unset, it is read from the API's e2e
# seeder (the series with playable media), which is also what the web suite drives.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

APP_ID="com.mobirizer.katha"

# Maestro is a JVM tool. A system install is not assumed: an unpacked Temurin under ~/.jdks (where the Android
# build looks too) or the JDK Android Studio ships with is enough.
has_java() { [ -n "${1:-}" ] && [ -x "$1/bin/java" ]; }
if ! has_java "${JAVA_HOME:-}"; then
  JAVA_HOME=""
  for candidate in "$HOME/.jdks/temurin-17" "$HOME/.jdks"/jdk-17* "/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
    if has_java "$candidate"; then JAVA_HOME="$candidate"; break; fi
  done
fi
if [ -z "${JAVA_HOME:-}" ]; then
  echo "No JDK found for Maestro — unpack a Temurin 17 under ~/.jdks (see scripts/build-android.sh) or install Android Studio." >&2
  exit 1
fi
export JAVA_HOME

MAESTRO="${MAESTRO_BIN:-}"
if [ -z "$MAESTRO" ]; then
  for candidate in "$HOME/.maestro/maestro/bin/maestro" "$HOME/.maestro/bin/maestro"; do
    if [ -x "$candidate" ]; then MAESTRO="$candidate"; break; fi
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

# The flows run on the booted simulator. A physical iPhone is refused with a reason rather than a UDID that
# Maestro will report as "not connected" whatever the phone is doing.
if [ -n "${E2E_IOS_DEVICE:-}" ]; then
  cat >&2 <<'MSG'
E2E_IOS_DEVICE is set, but Maestro cannot drive a physical iPhone: its iOS support is Xcode simulators only.
Verify hardware by hand (see the header of this script), and run the flows on a simulator of the same iOS
version by leaving E2E_IOS_DEVICE unset.
MSG
  exit 2
fi

if ! xcrun simctl list devices booted | grep -q "(Booted)"; then
  echo "No iOS simulator is booted. Start one: xcrun simctl boot \"iPhone 17\"" >&2
  exit 1
fi
if ! xcrun simctl get_app_container booted "$APP_ID" >/dev/null 2>&1; then
  echo "$APP_ID is not installed on the booted simulator. Build and install it first — see the header of this script." >&2
  exit 1
fi
DEVICE="$(xcrun simctl list devices booted | grep -oE "[0-9A-F-]{36}" | head -1)"

if [ -z "${SERIES_TITLE:-}" ]; then
  API_DIR="$(cd ../../services/api && pwd)"
  PY="$API_DIR/.venv/bin/python"
  if [ -x "$PY" ]; then
    FIXTURE="$(cd "$API_DIR" && "$PY" scripts/seed_e2e.py --json)"
    SERIES_TITLE="$(printf '%s' "$FIXTURE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("primary") or d["series"][0])["title"])')"
    SERIES_SLUG="$(printf '%s' "$FIXTURE" | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("primary") or d["series"][0])["slug"])')"
  fi
fi

# Maestro phones home about CLI usage unless told not to; a test run should not depend on that.
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true

TARGET="${1:-e2e/}"
echo "==> maestro test $TARGET on $DEVICE (SERIES_TITLE=${SERIES_TITLE:-<flow default>})"
if [ -n "${SERIES_TITLE:-}" ]; then
  # The title, the word a viewer would search for it by, and the slug a share link carries.
  "$MAESTRO" --device "$DEVICE" test -e SERIES_TITLE="$SERIES_TITLE" -e SERIES_QUERY="${SERIES_TITLE%% *}" -e SERIES_SLUG="${SERIES_SLUG:-}" "$TARGET"
else
  "$MAESTRO" --device "$DEVICE" test "$TARGET"
fi
