# Copy the latest Arrs Hub Status universal APK into Google Drive\apks.
# Named with version so phones can grab a clear file from Drive (same pattern as Ava Bedtime).
#
# Usage:
#   .\scripts\publish-apk-to-drive.ps1
#   .\scripts\publish-apk-to-drive.ps1 -Build   # assembleDebug first

param(
    [switch]$Build
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$DriveApks = "G:\My Drive\apks"
$ApkSource = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
$GradleFile = Join-Path $Root "android\app\build.gradle"
$LocalApks = Join-Path $Root "apks"

if (-not (Test-Path "G:\My Drive")) {
    throw "Google Drive not available at G:\My Drive"
}

New-Item -ItemType Directory -Force -Path $DriveApks | Out-Null
New-Item -ItemType Directory -Force -Path $LocalApks | Out-Null

if ($Build) {
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
    Push-Location (Join-Path $Root "android")
    try {
        & .\gradlew.bat :app:assembleDebug
        if ($LASTEXITCODE -ne 0) {
            throw "assembleDebug failed"
        }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $ApkSource)) {
    throw "APK not found: $ApkSource (build first, or pass -Build)"
}

$gradleText = Get-Content -LiteralPath $GradleFile -Raw
if ($gradleText -notmatch 'versionName\s+"([^"]+)"') {
    throw "Could not read versionName from android\app\build.gradle"
}
$versionName = $Matches[1]
$code = if ($gradleText -match 'versionCode\s+(\d+)') { $Matches[1] } else { "0" }

$versionedName = "ArrsHubStatus-$versionName($code).apk"
$universalName = "ArrsHubStatus-universal.apk"
$latestName = "ArrsHubStatus-latest.apk"

foreach ($destRoot in @($DriveApks, $LocalApks)) {
    Copy-Item -LiteralPath $ApkSource -Destination (Join-Path $destRoot $versionedName) -Force
    Copy-Item -LiteralPath $ApkSource -Destination (Join-Path $destRoot $universalName) -Force
    Copy-Item -LiteralPath $ApkSource -Destination (Join-Path $destRoot $latestName) -Force
}

Write-Host "Copied universal APK to Drive:"
Write-Host "  $(Join-Path $DriveApks $versionedName)"
Write-Host "  $(Join-Path $DriveApks $universalName)"
Write-Host "  $(Join-Path $DriveApks $latestName)"
Write-Host "Local copies (gitignored *.apk):"
Write-Host "  $(Join-Path $LocalApks $universalName)"
