# Switch Arrs Hub Mobile between production Status and Tester applicationIds.
# Usage:
#   .\scripts\set-app-variant.ps1 -Variant tester
#   .\scripts\set-app-variant.ps1 -Variant status

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("status", "tester")]
    [string]$Variant
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$javaRoot = Join-Path $Root "android\app\src\main\java\com\arrshub"
$statusDir = Join-Path $javaRoot "status"
$testerDir = Join-Path $statusDir "tester"

$meta = @{
    status = @{
        appId      = "com.arrshub.status"
        appName    = "Arrs Hub Status"
        javaPkg    = "com.arrshub.status"
        javaDir    = $statusDir
        shareApk   = "ArrsHubStatus-update.apk"
        shareJson  = "ArrsHubStatus-settings.json"
        shareTitle = "Arrs Hub Status"
        sharePrefix = "ArrsHubStatus-"
    }
    tester = @{
        appId      = "com.arrshub.status.tester"
        appName    = "Arrs Hub Mobile Tester"
        javaPkg    = "com.arrshub.status.tester"
        javaDir    = $testerDir
        shareApk   = "ArrsHubMobileTester-update.apk"
        shareJson  = "ArrsHubMobileTester-settings.json"
        shareTitle = "Arrs Hub Mobile Tester"
        sharePrefix = "ArrsHubMobileTester-"
    }
}

$target = $meta[$Variant]

# Locate current Java sources (either package layout).
$srcDir = $null
foreach ($candidate in @($testerDir, $statusDir)) {
    if (Test-Path (Join-Path $candidate "MainActivity.java")) {
        $srcDir = $candidate
        break
    }
}
if (-not $srcDir) {
    throw "Could not find MainActivity.java under android/app/src/main/java/com/arrshub/status"
}

$destDir = [string]$target.javaDir
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

Get-ChildItem -LiteralPath $srcDir -Filter "*.java" -File | ForEach-Object {
    $text = Get-Content -LiteralPath $_.FullName -Raw
    $text = [regex]::Replace(
        $text,
        '(?m)^package\s+com\.arrshub\.status(?:\.tester)?;',
        "package $($target.javaPkg);"
    )
    if ($_.Name -eq "ApkSharePlugin.java") {
        $text = [regex]::Replace($text, 'SHARE_NAME = "[^"]+"', "SHARE_NAME = `"$($target.shareApk)`"")
        $text = [regex]::Replace($text, 'DEFAULT_SETTINGS_NAME = "[^"]+"', "DEFAULT_SETTINGS_NAME = `"$($target.shareJson)`"")
        $text = [regex]::Replace(
            $text,
            'Arrs Hub (?:Status|Mobile Tester)',
            [string]$target.shareTitle
        )
        $text = [regex]::Replace(
            $text,
            'ArrsHub(?:Status|MobileTester)-',
            [string]$target.sharePrefix
        )
    }
    $out = Join-Path $destDir $_.Name
    Set-Content -LiteralPath $out -Value $text -NoNewline
    if ($srcDir -ne $destDir) {
        Remove-Item -LiteralPath $_.FullName -Force
    }
}

if ($srcDir -ne $destDir) {
    Get-ChildItem -LiteralPath $srcDir -Filter "*.java" -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    if ($Variant -eq "status" -and (Test-Path $testerDir)) {
        Remove-Item -LiteralPath $testerDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($Variant -eq "tester") {
        # Drop orphan Java left directly under com/arrshub/status/ (not in tester/)
        Get-ChildItem -LiteralPath $statusDir -Filter "*.java" -File -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
    }
}

# build.gradle
$gradle = Join-Path $Root "android\app\build.gradle"
$g = Get-Content -LiteralPath $gradle -Raw
$g = [regex]::Replace($g, 'namespace\s+"[^"]+"', "namespace `"$($target.appId)`"")
$g = [regex]::Replace($g, 'applicationId\s+"[^"]+"', "applicationId `"$($target.appId)`"")
Set-Content -LiteralPath $gradle -Value $g -NoNewline

# strings.xml
$strings = Join-Path $Root "android\app\src\main\res\values\strings.xml"
$s = Get-Content -LiteralPath $strings -Raw
$s = [regex]::Replace($s, '(?s)(<string name="app_name">)[^<]+', "`${1}$($target.appName)")
$s = [regex]::Replace($s, '(?s)(<string name="title_activity_main">)[^<]+', "`${1}$($target.appName)")
$s = [regex]::Replace($s, '(?s)(<string name="package_name">)[^<]+', "`${1}$($target.appId)")
$s = [regex]::Replace($s, '(?s)(<string name="custom_url_scheme">)[^<]+', "`${1}$($target.appId)")
Set-Content -LiteralPath $strings -Value $s -NoNewline

# capacitor.config.ts
$cap = Join-Path $Root "capacitor.config.ts"
$c = Get-Content -LiteralPath $cap -Raw
$c = [regex]::Replace($c, 'appId:\s*"[^"]+"', "appId: `"$($target.appId)`"")
$c = [regex]::Replace($c, 'appName:\s*"[^"]+"', "appName: `"$($target.appName)`"")
Set-Content -LiteralPath $cap -Value $c -NoNewline

# version.ts display name (ASCII hyphen to avoid encoding issues)
$ver = Join-Path $Root "src\version.ts"
$v = Get-Content -LiteralPath $ver -Raw
$v = [regex]::Replace(
    $v,
    '(?m)^/\*\*[^*]*\*/\s*',
    "/** $($target.appName) - single source for display name + semver. */`r`n"
)
$v = [regex]::Replace($v, 'export const APP_NAME = "[^"]+"', "export const APP_NAME = `"$($target.appName)`"")
Set-Content -LiteralPath $ver -Value $v -NoNewline

Write-Host "Switched to $Variant ($($target.appId) / $($target.appName))"
