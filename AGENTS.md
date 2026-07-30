# Agent standing rules (Andrew)

## Phone APKs → Google Drive (always)

Whenever Android / Capacitor changes ship for **Arrs Hub Status** or **Ava Bedtime**:

1. Build a **universal** debug APK (`npm run apk:debug` / `assembleDebug`), not an Android Studio split “Run” deploy.
2. Publish with stable Drive names so the Pixel bookmark keeps working:
   - `ArrsHubStatus.apk`
   - `AvaBedtime.apk`
3. Prefer `npm run apk:publish` (this repo) or `npm run apk:publish:all` when Ava’s project is on disk.
4. Targets:
   - **Windows Drive Desktop:** `G:\My Drive\Phone APKs\` (auto-created under My Drive)
   - **Cloud agents:** `credentials.drive.json` from `drive.publish.example.json` (folder shared with the service account)

Do **not** tell Andrew to Quick Share as the primary install path. Drive remote install is the default.
