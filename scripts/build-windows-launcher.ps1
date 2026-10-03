param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    throw "Python 3.10 or newer is required to build the launcher."
}
$version = & $python.Source --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Could not run Python. Install Python 3.10 or newer and retry."
}

$output = Join-Path $root "dist\GeometryLearningApp"
$work = Join-Path $root "build\pyinstaller"
if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
New-Item -ItemType Directory -Path $work -Force | Out-Null

if (-not $SkipInstall) {
    & $python.Source -m pip install -r requirements.txt pyinstaller
    if ($LASTEXITCODE -ne 0) {
        throw "Installing Python build dependencies failed."
    }
}

& $python.Source -m PyInstaller --noconfirm --clean --distpath (Split-Path -Parent $output) --workpath $work geometry-learning-app.spec
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed to build the launcher."
}

$exe = Join-Path $output "GeometryLearningApp.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "Build completed without producing $exe"
}
Write-Host "Build complete: $exe"
