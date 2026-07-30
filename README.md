# Arrs Hub Mobile (standalone)

Android status + in-app opener for your *arr stack. **Does not require Arrs Hub**
to be running.

## For Andrew

You do **not** run `npm` / `cap sync`. Cursor makes the edits; with live reload +
USB, the tablet updates like Ava’s bedtime app. Just leave Android Studio open
and the app running on the tablet.

## What it does

1. **Status** — polls each enabled service (native HTTP in the APK)
2. **Open & edit** — tap a service to open it in-app; use **Browser** if embed is blocked
3. **Settings** — URLs / optional API keys on the device

Defaults use `http://67.84.101.14` (same remote host as Arrs Hub).

## Agent / first-time setup

```bat
npm install
npm run live:prepare
npm run dev
npx cap open android
```

Then **Run** once on the tablet (USB). Keep Vite (`npm run dev`) running so UI
changes hot-reload. `live:prepare` sets Capacitor to `http://localhost:5174`
and runs `adb reverse`.

Release / offline APK (no live server): unset live URL, `npm run cap:sync`, then build a **universal** (fat) APK:

```bat
cd android
gradlew.bat :app:assembleDebug
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`  
Copy to Drive (and local `apks/`): `powershell -ExecutionPolicy Bypass -File scripts\publish-apk-to-drive.ps1`  
(or pass `-Build` to assemble + publish). Destination: `G:\My Drive\apks\ArrsHubStatus-universal.apk`.
