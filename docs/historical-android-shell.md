> Historical shell documentation from the pre-native-beta project. Historical names and artifact references are retained. See [current Re:Awaken Android instructions](../README.md).

# Cross Road Android — proof of concept

A separate Android shell for the Cross Road KINGDOM HEARTS Union χ / Dark Road preservation runtime. This is not the original Android client or a server restoration project. The iPhone project is unchanged.

**Status:** initial implementation for device testing. An APK build or runtime boot test does not prove playable KHUX, physical-phone audio or native game-save persistence.

## Install the test APK

1. Open [Android debug APK builds](https://github.com/qqCLUTCHYqq/cross-road-android/actions/workflows/android.yml).
2. Select the latest successful run. Signed into GitHub, download **CrossRoad-Android-debug** under Artifacts.
3. Extract the ZIP and open **app-debug.apk** on your Android phone. Allow your browser/file manager to install this app when Android asks.
4. Open **Cross Road**, then **Start KHUX / Dark Road**. Stay online while Content streams. Tap the game to unlock audio.

Android 9+ is the installation minimum. A recent Android System WebView/Chrome with WebAssembly, worker OffscreenCanvas/WebGL and DecompressionStream is required; the OS minimum alone does not guarantee compatibility. No GitHub Release is published.

## Physical-phone acceptance checklist

- Run the runtime boot check: 101 native constructors and JNI initialization.
- Start game → title screen → enter KHUX and reach a playable screen.
- Tap/hold/drag/release; enter and leave native menus. Repeat after rotating.
- Verify audible continuous audio; background and return, tapping to resume if needed.
- Change something the game normally saves. Complete its native Save/confirmation, wait a few seconds, then **Force stop** Cross Road in Android Settings. Reopen and verify that exact change survives. Repeat once.

Progress saved by the game stays in local app storage. Do not uninstall or clear app storage to restart. Restart reloads the runtime without clearing saves, but unsaved changes can be lost. Debug logs must not be shared with save contents or personal information.

CI caches a debug signing identity. If that cache expires, a later APK may have a different certificate. Do not uninstall a copy with valuable saves merely to install a mismatched APK. Stable release signing and a native backup UI are deferred.

## Build locally

Install JDK 17, Android SDK 36/build tools, Node 22 and Gradle 8.13. Set `ANDROID_HOME` or an uncommitted `local.properties`.

```sh
node scripts/prepare-runtime.mjs
node scripts/test-platform.mjs
mkdir -p .debug
keytool -genkeypair -keystore .debug/debug.keystore -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US'
gradle :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

Generate the debug key only once. Output: `app/build/outputs/apk/debug/app-debug.apk`. CI uses the same pinned Gradle version; no wrapper binary is included in this initial project.

Build preparation downloads a checksum-verified, commit-pinned runtime, not a moving branch. The APK bundles runtime code, not the 2+ GB Content collection. No Cloudflare credentials are required. See [technical notes](../TECHNICAL.md).

## Legal / attribution

Unofficial fan preservation project. Not affiliated with or endorsed by Square Enix or Disney. KINGDOM HEARTS and related intellectual property belong to their respective rights holders. The Android shell is distinct from the original Cross Road author's work and iPhone adaptations. No ownership or blanket license over third-party material is claimed. See [LEGAL.md](../LEGAL.md).
