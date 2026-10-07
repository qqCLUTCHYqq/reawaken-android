# Re:Awaken Android

**ANDROID BETA — PHYSICAL DEVICE TESTERS WANTED**

Re:Awaken Android Beta 1 installs the original KHUX + Dark Road **5.0.1 WW** client from your own compatible XAPK. Android is a public beta: **not yet proven on physical hardware**.

[Download Android Beta 1](https://github.com/qqCLUTCHYqq/reawaken-android/releases/tag/reawaken-android-v1.0.0-beta.1) · [Tester feedback](https://github.com/qqCLUTCHYqq/reawaken-android/issues)

## Install

Use a Windows 10/11 x64 PC, Android device, USB data cable, USB debugging and your user-owned compatible XAPK. The PC needs internet for legitimate ADB tools and acceptance of Google SDK terms. A verified official Node runtime and license are included. Allow about 2.3 GB of staging space plus the XAPK/tools and about 3 GB free on Android.

1. Extract the attached **ReAwaken-Android-Beta-1-Windows-x64.zip** into a writable folder and open **ReAwaken-Android-Beta.exe**.
2. Connect/unlock Android. Tap Build number seven times in Settings → About device (sometimes Software information). Enable USB debugging in Developer Options and accept the computer authorization prompt.
3. Select your XAPK, review SDK terms, then click **Install on Android**.
4. Re:Awaken validates APK/main.76/patch.87, installs without root, transfers both OBBs, verifies device SHA256 hashes, and launches the game.
5. If direct OBB access is restricted, follow the companion's normal storage and **Allow from this source** prompts, then **Continue**. Keep Android connected/unlocked and the companion foreground.

Existing game installations/content are preserved and refused for replacement. If both supported routes fail, installation stops clearly. No root, bootloader unlocking, custom firmware, file-manager hacks, game patches or re-signing. No game APK, XAPK, OBB, saves or copyrighted game content is included or downloaded. No Android Save Editor or controller mapping is included.

## Evidence and feedback

Proven in Android 11 emulator: APK validation, non-root APK installation, non-root OBB placement, SHA256 verification, game launch, Dark Road offline gameplay, Union χ Theater offline playback and progress persistence. Non-root installation used a fresh, never-rooted installation emulator. Earlier gameplay validation used another emulator with root only for initial development OBB placement; the released installer never uses root.

Physical hardware remains untested. Android 11 is proven; the companion's Android 8+ declared range is conditional on access and ABI/API checks. Other versions, OEM firmware and AYN Thor are untested. Only the primary Android user is supported.

Click **Export Beta Report**, review it and attach it to [GitHub Issues](https://github.com/qqCLUTCHYqq/reawaken-android/issues). Include model, Android version, success/failure and reproduction steps. Reports contain version/device details, installation stages and fixed sanitized error codes, without serials, credentials, personal paths, raw logs, game bytes or saves. Nothing is automatically uploaded; never attach runtime-cache or game/save files.

The repository is now **qqCLUTCHYqq/reawaken-android**. Releases, tags, issues and history are retained. The original Beta 1 ZIP/checksum is unchanged; its old feedback links remain usable through redirects. **The original published Android Beta 1 has no in-app updater.** The current native desktop source adds startup checks, Settings → Check for Updates, Beta/Stable channels, verified downloads and rollback. Existing users need one updater-enabled download before future in-app updates. See [updater build/recovery instructions](docs/android-desktop-updater.md). [Release discovery](https://api.github.com/repos/qqCLUTCHYqq/reawaken-android/releases) includes prereleases; stable-only latest-release queries are not a beta-update mechanism.

## iPhone / iPad and historical implementation

[Stable Re:Awaken iOS v1.0.2](https://github.com/qqCLUTCHYqq/reawaken-ios/releases/tag/reawaken-v1.0.2) remains separate. Android branding work does not alter it.

The earlier Kotlin/WebView/WASM shell is retained separately. [Historical shell documentation](docs/historical-android-shell.md), [technical notes](TECHNICAL.md) and [legal/attribution](LEGAL.md) preserve provenance. Package IDs, storage names, bridge symbols, original artifacts and signing-cache keys retain historical names for compatibility. The native beta does not use that shell's runtime/content preparation scripts. [Native beta installer source](https://github.com/qqCLUTCHYqq/reawaken-android/tree/reawaken-android-beta/ReAwaken/Android) is maintained separately. GitHub-generated source archives are not the Windows installer.
