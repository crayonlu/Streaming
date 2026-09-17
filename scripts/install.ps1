<#
.SYNOPSIS
    Streaming -- installer / updater for Windows.

.DESCRIPTION
    Downloads the matching NSIS installer straight from GitHub Releases and
    runs it silently. Running it again upgrades an existing installation.

    Run it straight from the web:

      irm https://raw.githubusercontent.com/crayonlu/Streaming/main/scripts/install.ps1 | iex

    Or download it and run with options:

      .\install.ps1 -Check
      .\install.ps1 -Version v0.6.0
      .\install.ps1 -PrintUrl

.PARAMETER Version
    Install a specific version, e.g. v0.6.0 or 0.6.0. Default: the latest release.

.PARAMETER Check
    Only report whether an update is available. Installs nothing.

.PARAMETER PrintUrl
    Print the download URL and exit. Installs nothing.

.PARAMETER Force
    Reinstall even when the installed version already matches.

.PARAMETER Yes
    Do not ask for confirmation.

.PARAMETER Interactive
    Run the installer's UI instead of a silent install.
#>
[CmdletBinding()]
param(
    [Alias('v')]
    [string]$Version,

    [switch]$Check,
    [switch]$PrintUrl,
    [switch]$Force,
    [switch]$Yes,
    [switch]$Interactive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo    = if ($env:STREAMING_REPO) { $env:STREAMING_REPO } else { 'crayonlu/Streaming' }
$AppName = 'streaming'

# ---------------------------------------------------------------- output ----

function Write-Info { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Blue }
function Write-Ok   { param([string]$Message) Write-Host "  [ok] $Message" -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host "  $Message" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Message) Write-Host "  [!] $Message" -ForegroundColor Yellow }
function Stop-Fail  { param([string]$Message) Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------- api helpers --

function Get-Release {
    param([string]$Tag)

    $path = if ($Tag) { "releases/tags/$Tag" } else { 'releases/latest' }
    $uri  = "https://api.github.com/repos/$Repo/$path"

    $headers = @{
        'Accept'     = 'application/vnd.github+json'
        'User-Agent' = 'streaming-install-ps1'
    }
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $($env:GITHUB_TOKEN)" }

    try {
        return Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec 30
    } catch {
        return $null
    }
}

function Get-InstalledVersion {
    $keys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($key in $keys) {
        $entries = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -eq $AppName -and $_.DisplayVersion }
        if ($entries) {
            return ($entries | Select-Object -First 1).DisplayVersion
        }
    }
    return $null
}

# ---------------------------------------------------------------- resolve ---

$release = $null
$tag     = $null

if ($Version) {
    $tag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
} else {
    Write-Info 'Looking up the latest release'
    $release = Get-Release
    if ($release) { $tag = $release.tag_name }
    if (-not $tag) {
        Stop-Fail @'
could not determine the latest release.
    - Check your network connection, or
    - set GITHUB_TOKEN to raise the GitHub API rate limit, or
    - pin a version explicitly:  .\install.ps1 -Version v0.6.0
'@
    }
}

$targetVersion = $tag.TrimStart('v')

if (-not $release -and $Version) { $release = Get-Release -Tag $tag }

# Pick the NSIS installer. CI publishes x64 only.
$asset = $null
if ($release) {
    $asset = $release.assets | Where-Object { $_.name -like '*x64-setup.exe' } | Select-Object -First 1
}

if ($asset) {
    $assetUrl = $asset.browser_download_url
} else {
    $assetUrl = "https://github.com/$Repo/releases/download/$tag/${AppName}_${targetVersion}_x64-setup.exe"
    Write-Note 'GitHub API unavailable, using the direct asset URL'
}

if ($PrintUrl) {
    Write-Output $assetUrl
    exit 0
}

$installed = Get-InstalledVersion

Write-Info "Streaming $targetVersion (windows/x64)"
if ($installed) { Write-Note "installed: $installed" } else { Write-Note 'installed: none' }

if ($Check) {
    if (-not $installed) {
        Write-Host ''
        Write-Host 'Not installed. Run without -Check to install.' -ForegroundColor Yellow
        exit 0
    }
    if ($installed -eq $targetVersion) {
        Write-Host ''
        Write-Host "Up to date. ($installed)" -ForegroundColor Green
        exit 0
    }
    Write-Host ''
    Write-Host "Update available: $installed -> $targetVersion" -ForegroundColor Yellow
    Write-Note 'run: .\install.ps1'
    exit 0
}

if ($installed -and $installed -eq $targetVersion -and -not $Force) {
    Write-Ok "Already at $targetVersion, nothing to do."
    Write-Note 'Use -Force to reinstall.'
    exit 0
}

if (-not $Yes -and -not [System.Console]::IsInputRedirected) {
    $prompt = if ($installed) { "Upgrade $installed -> $targetVersion?" } else { "Install Streaming $targetVersion?" }
    $answer = Read-Host "$prompt [y/N]"
    if ($answer -notmatch '^(y|yes)$') { Write-Host 'Aborted.'; exit 0 }
}

# --------------------------------------------------------------- download ---

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "streaming-install-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null

try {
    $installer = Join-Path $tmp (Split-Path $assetUrl -Leaf)
    Write-Info "Downloading $(Split-Path $assetUrl -Leaf)"
    Write-Note $assetUrl

    $progress = $ProgressPreference
    $ProgressPreference = 'Continue'
    try {
        Invoke-WebRequest -Uri $assetUrl -OutFile $installer -UseBasicParsing
    } finally {
        $ProgressPreference = $progress
    }

    if (-not (Test-Path $installer) -or (Get-Item $installer).Length -eq 0) {
        Stop-Fail 'downloaded file is empty'
    }

    Write-Info 'Running the installer'
    $arguments = if ($Interactive) { @() } else { @('/S') }
    $proc = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        Stop-Fail "the installer exited with code $($proc.ExitCode)"
    }
} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# ----------------------------------------------------------------- verify ---

$final = Get-InstalledVersion
Write-Host ''
if ($final) {
    Write-Ok "Streaming $final installed"
} else {
    Write-Ok "Streaming $targetVersion installed"
}
Write-Note 'Launch it from the Start menu.'
