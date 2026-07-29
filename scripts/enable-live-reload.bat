@echo off
REM Agent/dev live-reload helper — Andrew does not need to run this.
cd /d "%~dp0"
set "NODE_OPTIONS=%NODE_OPTIONS% --use-system-ca"
set "CAPACITOR_LIVE_RELOAD_URL=http://localhost:5174"

where adb >nul 2>&1
if not errorlevel 1 (
  adb reverse tcp:5174 tcp:5174 >nul 2>&1
  echo adb reverse: tablet localhost:5174 -^> PC Vite
) else (
  echo adb not on PATH — plug tablet in USB and ensure platform-tools are available.
)

call npm run build
call npx cap sync android
echo.
echo Start Vite with: npm run dev
echo Then Run the app once from Android Studio (or leave it open). UI edits hot-reload.
