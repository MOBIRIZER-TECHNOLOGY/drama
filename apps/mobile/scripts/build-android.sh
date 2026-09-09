#!/usr/bin/env bash
#
# Build an installable Android APK without EAS, an Expo account, or a system JDK install.
#
# Two variants, and the difference matters:
#
#   release  a standalone APK. The JS is compiled into it, so it runs with no Metro and no laptop —
#            this is the one to put on a phone or hand to someone.
#   debug    a development client. It loads JS from Metro over the network, so `expo start` has to be
#            running and reachable; in exchange, edits reload without rebuilding.
#
# The API and media hosts are baked in at build time. Point them at a LAN address for a test build
# (plugins/with-cleartext-hosts.js then permits cleartext to exactly those hosts, and nothing else) or at
# the real https origins for anything you would ship.
#
# Usage:
#   scripts/build-android.sh                                  # release, against $EXPO_PUBLIC_API_URL
#   scripts/build-android.sh --variant debug
#   scripts/build-android.sh --api https://api.katha.app --media https://cdn.katha.app
#   scripts/build-android.sh --abis x86_64                    # emulator only; roughly halves the build
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
MOBILE_DIR="$(pwd)"

VARIANT="release"
ABIS="x86_64,arm64-v8a"
API_URL="${EXPO_PUBLIC_API_URL:-}"
MEDIA_URL="${EXPO_PUBLIC_MEDIA_URL:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --variant) VARIANT="$2"; shift 2 ;;
    --abis)    ABIS="$2"; shift 2 ;;
    --api)     API_URL="$2"; shift 2 ;;
    --media)   MEDIA_URL="$2"; shift 2 ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$VARIANT" in
  release|debug) ;;
  *) echo "--variant must be 'release' or 'debug', got '$VARIANT'." >&2; exit 2 ;;
esac

# --- Toolchain -------------------------------------------------------------------------------------------
# Gradle needs a JDK 17. A system install is not required and not assumed: an unpacked Temurin under
# ~/.jdks is enough, which is also where Android Studio looks, so the two agree if both are present.
has_java() {
  [ -n "${1:-}" ] && { [ -x "$1/bin/java" ] || [ -x "$1/bin/java.exe" ]; }
}
if ! has_java "${JAVA_HOME:-}"; then
  JAVA_HOME=""
  for candidate in "$HOME/.jdks/temurin-17" "$HOME/.jdks"/jdk-17*; do
    if has_java "$candidate"; then
      JAVA_HOME="$candidate"
      break
    fi
  done
fi
if [ -z "${JAVA_HOME:-}" ]; then
  cat >&2 <<'MSG'
No JDK 17 found. Unpack one — no installer, no admin rights:

  curl -Lo jdk.zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
  unzip -q jdk.zip -d "$HOME/.jdks" && mv "$HOME/.jdks"/jdk-17* "$HOME/.jdks/temurin-17"

(On macOS or Linux swap `windows/x64` for `mac/aarch64` or `linux/x64`.)
MSG
  exit 1
fi
export JAVA_HOME

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
if [ ! -d "$ANDROID_HOME/platform-tools" ]; then
  echo "No Android SDK at $ANDROID_HOME. Set ANDROID_HOME, or install it through Android Studio." >&2
  exit 1
fi
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"

if [ -n "$API_URL" ]; then export EXPO_PUBLIC_API_URL="$API_URL"; fi
if [ -n "$MEDIA_URL" ]; then export EXPO_PUBLIC_MEDIA_URL="$MEDIA_URL"; fi

# --- Native project --------------------------------------------------------------------------------------
# android/ is generated and gitignored, so it is regenerated every time rather than trusted: the API host and
# the cleartext policy are both baked in here, and a stale tree bakes in the previous run's answers. Metro
# holds a handle on the directory on Windows, which is why prebuild's own --clean is not used.
echo "==> Prebuilding (api=${EXPO_PUBLIC_API_URL:-<app.config default>})"
rm -rf android 2>/dev/null || {
  echo "Could not remove android/ — stop Metro (expo start) and run again." >&2
  exit 1
}
npx expo prebuild --platform android --no-install

# Gradle finds the SDK through local.properties; ANDROID_HOME alone is not read on every platform.
printf 'sdk.dir=%s\n' "$(cd "$ANDROID_HOME" && pwd -W 2>/dev/null || echo "$ANDROID_HOME")" > android/local.properties

# --- Build -----------------------------------------------------------------------------------------------
GRADLE_ARGS=("-PreactNativeArchitectures=$ABIS")
if [ "$VARIANT" = "release" ]; then
  KEYSTORE="$MOBILE_DIR/credentials/release.keystore"
  if [ ! -f "$KEYSTORE" ]; then
    echo "No signing key at $KEYSTORE — see credentials/README.md." >&2
    exit 1
  fi
  # Passed on the command line rather than written into the generated build.gradle, which prebuild rewrites.
  GRADLE_ARGS+=(
    "-Pandroid.injected.signing.store.file=$(cd "$(dirname "$KEYSTORE")" && pwd -W 2>/dev/null || dirname "$KEYSTORE")/release.keystore"
    "-Pandroid.injected.signing.store.password=${KATHA_KEYSTORE_PASSWORD:-katha-release}"
    "-Pandroid.injected.signing.key.alias=${KATHA_KEY_ALIAS:-katha}"
    "-Pandroid.injected.signing.key.password=${KATHA_KEY_PASSWORD:-katha-release}"
  )
  TASK="assembleRelease"
else
  TASK="assembleDebug"
fi

echo "==> Gradle $TASK ($ABIS)"
(cd android && ./gradlew "$TASK" "${GRADLE_ARGS[@]}")

# app.json's version is the one that becomes the APK's versionName, so it is the one that belongs in the
# filename; package.json's is scaffold boilerplate that nothing on the device ever sees.
VERSION="$(node -p "require('./app.json').expo.version")"
mkdir -p dist
OUT="dist/katha-$VERSION-$VARIANT.apk"
cp "android/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk" "$OUT"

echo
echo "Built $OUT"
echo "Install with: adb install -r \"$MOBILE_DIR/$OUT\""
