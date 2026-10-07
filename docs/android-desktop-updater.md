# Re:Awaken Android Windows updater

The Windows application checks `qqCLUTCHYqq/reawaken-android` releases on startup and through **Settings → Check for Updates**. The update window shows installed/available versions, channel and release notes, with **Update Now** and **Later**. Checking is automatic; installation requires Update Now. No iOS repository or game service is contacted by this updater.

Beta installs default to **Beta**, which selects prereleases. **Stable** selects non-prereleases. Numeric semantic version comparison rejects downgrades and handles beta/rc ordering. Drafts, other products, missing SHA256 digests, ambiguous assets and wrong repository URLs are excluded. Network/rate-limit failures leave the current application usable.

## Bootstrap and release contract

The originally published Beta 1 executable contains no updater. It cannot receive this feature automatically. Those users must download an updater-enabled build once. Do not replace the historical Beta 1 release ZIP. After the updater-enabled build, subsequent compatible Android desktop releases can be installed in-app.

Build the C# launcher with .NET Framework 4.8's compiler using the same references as the original beta: System.Windows.Forms, System.Drawing, System.Net.Http, System.IO.Compression, System.IO.Compression.FileSystem and System.Web.Extensions. Output it to `ReAwaken/Android/ReAwaken-Android-Beta.exe`. The verified, pinned Node runtime and content companion must exist there as in the previous beta packaging workflow.

Run `node scripts/package-android-desktop.mjs VERSION OUTPUT.zip`. Use a real increasing version such as `1.0.0-beta.2` only for the actual next release; the local simulated Beta 2 is never published. Tag Android releases `reawaken-android-vVERSION`, mark betas prerelease, upload exactly one asset matching `ReAwaken-Android-NAME-Windows-x64.zip`, and include its generated `.sha256` file. GitHub's asset `digest` must be available as `sha256:…`; without it updates fail closed. The package generates consistent version metadata, diagnostic module version and `update-manifest.json`. Display/diagnostic versions in the C# launcher read this metadata.

The updater uses the published asset digest from GitHub's authenticated HTTPS release API, checks the entire ZIP before extraction, then checks every application file against the package manifest. It checks size limits, ZIP CRC, unsafe paths, case collisions and an exact application-file allowlist. Keep future packages within the existing allowlist; adding files requires a planned compatibility transition. The updater never downloads source archives as installers.

## State and failure safety

Settings are outside the application directory in `%LOCALAPPDATA%\ReAwaken\Android\settings.json`. The launcher stores selected XAPK location, SDK terms acceptance and update channel, and preserves unknown keys for device/diagnostic preferences and future save settings. Backups and other files in that state directory are not application update targets. Existing `Android/runtime-cache` is also outside the replacement list. No ADB execution, APK installation, OBB placement, game-file validation or Save Editor operation occurs while updating.

The old trusted helper and Node runtime are copied into an isolated update transaction directory under the state folder. It waits for the launcher to exit, acquires an exclusive application update lock, checks staging again, copies verified backups and records a durable per-file journal before replacement. Replacement uses a temporary file and rename; the application EXE is replaced last. No unrelated files are deleted. Linked paths are refused.

The new application relaunches and acknowledges startup only after reading settings and checking every installed application hash. Failure/timeout restores the journaled previous files and relaunches the old application. Backups are retained. Interrupted transactions are recovered on a later startup; an active helper prevents competing recovery. If Windows locks prevent recovery or the application itself cannot open after an interrupted update, close other copies and run the retained `Recover-Android.ps1` from the transaction folder under `%LOCALAPPDATA%\ReAwaken\Android\updates`. This uses the previous helper/runtime, without administrator rights. Do not discard that folder until recovery succeeds.

The environment variable `REAWAKEN_ANDROID_LOCAL_TEST_STATE` redirects only the desktop settings folder for isolated local testing. It does not change the production update feed or allow checksum bypasses. Production has no fake-release/network override.

## Validation

`node scripts/test-android-updater.mjs` builds local updater-enabled Beta 1 and simulated Beta 2 ZIPs and serves synthetic GitHub-shaped metadata/downloads through a loopback fixture. It runs the actual packaged Windows updater helper and C# launcher, verifies relaunch and startup acknowledgement, and checks preservation of settings, selected XAPK sentinel, device/diagnostics preferences, future backup sentinel, runtime cache and unrelated files. It also tests channel separation, wrong repository/missing digest rejection, bad ZIP SHA256, unmanaged paths, failed startup rollback and interrupted journal recovery. No test release, copyrighted game bytes or device operations are involved. Results are written under `build/`.

Physical-device Android installation remains public-beta territory. This Windows updater validation makes no new physical-device compatibility claim. iOS code and release assets are untouched.
