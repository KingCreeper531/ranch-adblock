# Builds Ranch Ad Blocker and publishes a GitHub release with:
#   - Ranch-AdBlock-Setup-<version>.exe          Windows installer (updates itself)
#   - Ranch-AdBlock-Android-<version>.apk        Android
#   - Ranch-AdBlock-iOS-AdGuard.mobileconfig     iPhone / iPad DNS profiles
#   - Ranch-AdBlock-iOS-Mullvad.mobileconfig
#   - latest.yml + .blockmap                     used by the Windows Update button
#
# Usage:  npm run release                 -> bumps patch if this version is already out
#         npm run release -- -Bump minor
param(
  [ValidateSet('patch', 'minor', 'major')] [string]$Bump = 'patch',
  [string]$Notes = ''
)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Run($exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed (exit $LASTEXITCODE)" }
}

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { throw "Releases come from the main branch (you're on '$branch'). Run: git checkout main" }

$repo = 'KingCreeper531/ranch-adblock'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
& gh release view "v$version" --repo $repo *> $null
if ($LASTEXITCODE -eq 0) {
  Run npm @('version', $Bump, '--no-git-tag-version')
  $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
}
Write-Host "Releasing Ranch Ad Blocker v$version" -ForegroundColor Green

# ---------------------------------------------------------------- Windows
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
Run npm @('run', 'build:ui')
Run npx @('electron-builder', '--win', '--publish', 'never')

# ---------------------------------------------------------------- Android
# If ~\.gradle isn't writable here, use a Gradle folder inside the project and pass the signing settings along.
$gradleHome = Join-Path $env:USERPROFILE '.gradle'
$canWrite = $true
try { $probe = Join-Path $gradleHome '.ranch-write-test'; [IO.File]::WriteAllText($probe, 'x'); Remove-Item $probe -Force } catch { $canWrite = $false }
if (-not $canWrite) {
  $env:GRADLE_USER_HOME = Join-Path (Get-Location) 'android\.gradle-home'
  Get-Content (Join-Path $gradleHome 'gradle.properties') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^(YTM_[A-Z_]+)=(.*)$' } |
    ForEach-Object { Set-Item -Path "env:ORG_GRADLE_PROJECT_$($Matches[1])" -Value $Matches[2] }
}
Push-Location android
try { Run '.\gradlew.bat' @('assembleRelease', '--no-daemon', '-q') } finally { Pop-Location }
Copy-Item "android\app\build\outputs\apk\release\Ranch-AdBlock-Android-$version.apk" 'dist\' -Force

# ---------------------------------------------------------------- iPhone
Copy-Item 'ios\*.mobileconfig' 'dist\' -Force

$assets = @(
  "dist\Ranch-AdBlock-Setup-$version.exe",
  "dist\Ranch-AdBlock-Setup-$version.exe.blockmap",
  'dist\latest.yml',
  "dist\Ranch-AdBlock-Android-$version.apk",
  'dist\Ranch-AdBlock-iOS-AdGuard.mobileconfig',
  'dist\Ranch-AdBlock-iOS-Mullvad.mobileconfig'
)
foreach ($a in $assets) { if (-not (Test-Path $a)) { throw "Missing build output: $a" } }

Run git @('add', '-A')
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { Run git @('commit', '-m', "Release v$version") }
Run git @('push', 'origin', 'HEAD')

if (-not $Notes) {
  $Notes = @"
## Download
- **Windows:** Ranch-AdBlock-Setup-$version.exe. Open it and press the switch; Windows asks for permission. It updates itself.
- **Android:** Ranch-AdBlock-Android-$version.apk (Android 9 or newer). Follow the one-time setup in the app.
- **iPhone / iPad:** open this page in Safari on the phone and tap **Ranch-AdBlock-iOS-AdGuard.mobileconfig** (or the Mullvad one). Then open **Settings**, tap **Profile Downloaded** and **Install**. Remove it any time under **Settings > General > VPN & Device Management**.

Or install and update it from the [Ranch Launcher](https://github.com/KingCreeper531/ranch-launcher/releases/latest).

Windows may show a SmartScreen warning because the app isn't code-signed. Click **More info**, then **Run anyway**.
"@
}
$notesFile = Join-Path $env:TEMP "ranch-adblock-notes-$version.md"
[IO.File]::WriteAllText($notesFile, $Notes)
$ghArgs = @('release', 'create', "v$version", '--repo', $repo, '--target', 'main', '--title', "Ranch Ad Blocker v$version", '--notes-file', $notesFile) + $assets
Run gh $ghArgs
Write-Host "Published https://github.com/$repo/releases/tag/v$version" -ForegroundColor Green