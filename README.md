# Arrs Hub Mobile (standalone)

Android status + in-app opener for your *arr stack. **Does not require Arrs Hub**
to be running. The phone talks to Sonarr, Radarr, Plex, etc. directly (same idea
as LunaSea).

## What it does

1. **Status** — polls each enabled service (native HTTP, no CORS issues in the APK)
2. **Open & edit** — tap a service to open it in-app (iframe viewer). If that app
   blocks embedding, use **Browser** in the top bar (Chrome Custom Tab) to edit.
3. **Settings** — URLs (and optional *arr API keys) stored on the device

Defaults use your remote host `http://67.84.101.14` (same as Arrs Hub remotes).

## Build / run (Ava bedtime style)

```bat
cd Arrs-Hub-Mobile
set NODE_OPTIONS=--use-system-ca
npm install
npm run cap:sync
npx cap open android
```

In Android Studio: sync Gradle → Run on your tablet/phone.

After UI changes: `npm run cap:sync` then Run again.

## Dev in browser

```bat
npm run dev
```

Browser probes may hit CORS; the **APK** uses Capacitor native HTTP and is the
real test path.

## Later (true LunaSea)

Replace per-app WebViews with native API screens (queue, calendar, wanted) one
service at a time. Status + open-in-app is the bridge.
