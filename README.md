# Arrs Hub Status (Android companion)

Separate Capacitor Android app that shows live app/PC status from **Arrs Hub**.
It does **not** replace the desktop hub — Arrs Hub still runs the watch loop; this phone app is a viewer.

Sibling project: [Arrs-Hub](https://github.com/machineshop44/arrs-hub) (desktop + sync server).

## Prerequisites

1. Arrs Hub running on your Plex PC with **LAN bind** (`ARRS_HUB_BIND=0.0.0.0` or `start-hub-lan.bat` in Arrs Hub)
2. Phone on the **same Wi‑Fi**
3. Android Studio (optional second window — leave your other apps alone)

## 1. Start Arrs Hub for LAN

In the **Arrs Hub** repo on the Plex PC:

- Run `start-hub-lan.bat`, or set `ARRS_HUB_BIND=0.0.0.0` before starting the hub

Find your PC LAN IP:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object IPAddress, InterfaceAlias
```

Phone hub URL example: `http://192.168.1.50:3847`

Allow inbound TCP **3847** in Windows Firewall (private network) if the phone cannot connect.

## 2. Develop this app in a browser

```bat
cd Arrs-Hub-Mobile
npm install
npm run dev
```

Open the Vite URL → Setup → enter hub base URL → confirm status updates.

## 3. Build the Android APK

```bat
cd Arrs-Hub-Mobile
npm install
npm run cap:sync
npx cap open android
```

In Android Studio (**File → Open → `Arrs-Hub-Mobile/android`** — use a second window if needed):

1. Wait for Gradle sync
2. Run on a device, or **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`

Install, open **Arrs Hub Status**, enter `http://<lan-ip>:3847`.

## API used (read-only)

| Call | Purpose |
|------|---------|
| `GET /api/health` | Hub reachable |
| `GET /api/watchdog/status` | Service + PC status |

This app does **not** push watch targets. Keep the desktop Arrs Hub open so targets stay registered.
