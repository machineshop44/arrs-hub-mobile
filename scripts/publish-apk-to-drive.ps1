# Copy the Arrs Hub Status APK into Google Drive\apks (and local apks/).
# Publishes only ArrsHubStatus-<versionName>(<versionCode>).apk and removes older versioned APKs.
# Does not create or keep ArrsHubStatus-latest.apk.
# Optionally installs the published APK onto every connected adb device (skips offline/unauthorized).
#
# Usage:
#   .\scripts\publish-apk-to-drive.ps1
#   .\scripts\publish-apk-to-drive.ps1 -Build          # assembleDebug first
#   .\scripts\publish-apk-to-drive.ps1 -Build -Install # also adb install -r on all devices

param(
    [switch]$Build,
    [switch]$Install
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$DriveApks = "G:\My Drive\apks"
$ApkSource = Join-Path $Root "android\app\build\outputs\apk\debug\app-debug.apk"
$GradleFile = Join-Path $Root "android\app\build.gradle"
$LocalApks = Join-Path $Root "apks"
$Prefix = "ArrsHubStatus-"

function Resolve-AdbPath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe"),
        (Join-Path $env:USERPROFILE "AppData\Local\Android\Sdk\platform-tools\adb.exe"),
        "C:\Android\platform-tools\adb.exe",
        "C:\Program Files\Android\Android Studio\platform-tools\adb.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    $fromPath = Get-Command adb -ErrorAction SilentlyContinue
    if ($fromPath) { return $fromPath.Source }
    return $null
}

function Install-ApkOnAllDevices {
    param(
        [Parameter(Mandatory = $true)][string]$ApkPath
    )

    $adb = Resolve-AdbPath
    if (-not $adb) {
        Write-Warning "adb not found - skip device install"
        return @()
    }

    $raw = & $adb devices
    $serials = @()
    foreach ($line in $raw) {
        if ($line -match "^\s*(\S+)\s+device\s*$") {
            $serials += $Matches[1]
        }
    }

    if ($serials.Count -eq 0) {
        Write-Warning "No adb devices in device state (skipped offline/unauthorized)"
        return @()
    }

    $installed = @()
    foreach ($serial in $serials) {
        Write-Host "Installing on $serial ..."
        $out = & $adb -s $serial install -r $ApkPath 2>&1
        $code = $LASTEXITCODE
        $out | ForEach-Object { Write-Host $_ }
        if ($code -eq 0) {
            Write-Host "Installed on $serial"
            $installed += $serial
        } else {
            Write-Warning "Install failed on $serial (exit $code)"
        }
    }
    return ,$installed
}

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
    # Web UI lives in android assets — sync Vite build before packaging.
    npm run cap:sync
    if ($LASTEXITCODE -ne 0) {
        throw "cap:sync failed"
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

$localApk = Join-Path $LocalApks $destName
Write-Host "Drive apk: $(Join-Path $DriveApks $destName)"
Write-Host "Local copy: $localApk"

if ($Install) {
    $installed = Install-ApkOnAllDevices -ApkPath $localApk
    if ($installed.Count -gt 0) {
        Write-Host ("Installed on: " + ($installed -join ", "))
    }
}
