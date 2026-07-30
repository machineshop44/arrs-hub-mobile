# Arrs Hub Mobile (standalone)

Android status + in-app opener for your *arr stack. **Does not require Arrs Hub**
to be running.

## For Andrew

You do **not** run `npm` / `cap sync`. Cursor makes the edits; with live reload +
USB, the tablet updates like Ava’s bedtime app. Just leave Android Studio open
and the app running on the tablet.

### Install / update on Pixel (preferred)

APKs are published to Google Drive folder **Phone APKs** with stable names:

| App | Drive file |
| --- | --- |
| Arrs Hub Status | `ArrsHubStatus.apk` |
| Ava Bedtime | `AvaBedtime.apk` |

On the phone: **Drive → Phone APKs → file → Install** (allow unknown apps if asked).
Agents / builds should overwrite those files whenever the app changes — no Quick Share needed.

Local publish (PC with Drive Desktop):

```bat
npm run apk:publish
npm run apk:publish:all
```

Cloud agents need `credentials.drive.json` (see `drive.publish.example.json`).


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

Release / offline APK (no live server): unset live URL, then:

```bat
npm run apk:debug
```

Universal debug APK (phones + tablets):

`android/app/build/outputs/apk/debug/app-debug.apk`

Install that file on a Pixel (Drive / email / USB). **Do not** rely on Share APK
from an Android Studio “Run” install — that is often a split package other
devices reject. Share APK works after the source device itself was installed
from this universal APK.

In Android Studio you can also **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

