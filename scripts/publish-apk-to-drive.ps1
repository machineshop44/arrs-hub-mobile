# Copy the latest Arrs Hub Status APK into Google Drive\apks (and local apks/).
# Keeps the current versioned file plus ArrsHubStatus-latest.apk alias.
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
$Prefix = "ArrsHubStatus-"
$LatestName = "${Prefix}latest.apk"

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

$destName = "$Prefix$versionName($code).apk"

foreach ($destRoot in @($DriveApks, $LocalApks)) {
    Get-ChildItem -LiteralPath $destRoot -Filter "$Prefix*.apk" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne $destName -and $_.Name -ne $LatestName } |
        Remove-Item -Force
    Copy-Item -LiteralPath $ApkSource -Destination (Join-Path $destRoot $destName) -Force
    Copy-Item -LiteralPath $ApkSource -Destination (Join-Path $destRoot $LatestName) -Force
}

Write-Host "Drive apks (Arrs): $(Join-Path $DriveApks $destName)"
Write-Host "Drive latest: $(Join-Path $DriveApks $LatestName)"
Write-Host "Local copy: $(Join-Path $LocalApks $destName)"
