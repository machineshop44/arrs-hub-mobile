# Copy the Arrs Hub Status APK into Google Drive\apks (and local apks/).
# Publishes only ArrsHubStatus-<versionName>(<versionCode>).apk and removes older versioned APKs.
# Does not create or keep ArrsHubStatus-latest.apk.
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

if (-not (Test-Path "G:\My Drive")) {
    throw "Google Drive not available at G:\My Drive"
}

New-Item -ItemType Directory -Force -Path $DriveApks | Out-Null
New-Item -ItemType Directory -Force -Path $LocalApks | Out-Null

if ($Build) {
    $env:JAVA_HOME = if (Test-Path "C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot") {
        "C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot"
    } elseif (Test-Path "C:\Program Files\Android\Android Studio\jbr") {
        "C:\Program Files\Android\Android Studio\jbr"
    } else {
        $env:JAVA_HOME
    }
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
    # Remove every prior ArrsHubStatus APK (including any leftover -latest.apk).
    Get-ChildItem -LiteralPath $destRoot -Filter "$Prefix*.apk" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne $destName } |
        ForEach-Object {
            try {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
            } catch {
                Write-Warning "Could not remove $($_.FullName): $($_.Exception.Message)"
            }
        }
    Copy-Item -LiteralPath $ApkSource -Destination (Join-Path $destRoot $destName) -Force
}

Write-Host "Drive apk: $(Join-Path $DriveApks $destName)"
Write-Host "Local copy: $(Join-Path $LocalApks $destName)"

