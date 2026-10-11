# QUIZFORGE

<#
.SYNOPSIS
    Starts the QuizForge backend and frontend for local development.
.DESCRIPTION
    Checks prerequisites, prepares the backend virtual environment, installs
    dependencies when needed, and launches both servers in separate windows.
    Existing .env files, databases and uploaded documents are never overwritten.
.PARAMETER SkipInstall
    Skip pip install / npm install.
.PARAMETER BackendOnly
    Start only the API.
.PARAMETER FrontendOnly
    Start only the Vite dev server.
.EXAMPLE
    .\start-dev.ps1
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyCommand.MyCommand.Definition
$backendDir  = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'
$venvPython  = Join-Path $backendDir 'venv\Scripts\python.exe'

function Write-Step($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Write-Ok($message)   { Write-Host "    $message" -ForegroundColor Green }
function Write-Warn2($message){ Write-Host "    $message" -ForegroundColor Yellow }

function Assert-PortFree($port, $label) {
    $inUse = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($inUse) {
        Write-Warn2 "Port $port is already in use, which blocks the $label server."
        Write-Warn2 "Close that process or change the port, then run this script again."
        exit 1
    }
}

if (-not $FrontendOnly) {
    Write-Step 'Checking the backend'

    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        Write-Error 'Python was not found on PATH. Install Python 3.11+ and try again.'
        exit 1
    }
    Write-Ok "Python $($python.Source)"

    if (-not (Test-Path $venvPython)) {
        Write-Step 'Creating the virtual environment'
        & $python.Source -m venv (Join-Path $backendDir 'venv')
    }
    Write-Ok 'Virtual environment ready'

    if (-not $SkipInstall) {
        Write-Step 'Installing backend dependencies'
        & $venvPython -m pip install --quiet --upgrade pip
        & $venvPython -m pip install --quiet -r (Join-Path $backendDir 'requirements.txt')
    }
    Write-Ok 'Backend dependencies installed'

    $envFile = Join-Path $backendDir '.env'
    if (-not (Test-Path $envFile)) {
        Copy-Item (Join-Path $backendDir '.env.example') $envFile
        Write-Warn2 'Created backend\.env from the example. Add an OPENAI_API_KEY there if you want AI generation.'
    } else {
        Write-Ok 'Existing backend\.env left untouched'
    }

    Assert-PortFree 8000 'backend'
}

if (-not $BackendOnly) {
    Write-Step 'Checking the frontend'

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Error 'Node.js was not found on PATH. Install Node.js 18+ and try again.'
        exit 1
    }
    Write-Ok "Node $((node --version))"

    if (-not $SkipInstall) {
        if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
            Write-Step 'Installing frontend dependencies (first run only)'
            Push-Location $frontendDir
            try { npm install } finally { Pop-Location }
        }
    }
    Write-Ok 'Frontend dependencies ready'

    Assert-PortFree 5173 'frontend'
}

Write-Step 'Starting servers'
Write-Host '    API      http://127.0.0.1:8000  (docs at /docs)' -ForegroundColor Green
Write-Host '    Frontend http://localhost:5173' -ForegroundColor Green
Write-Host '    Close each window with Ctrl+C to stop that service.' -ForegroundColor Yellow

if (-not $FrontendOnly) {
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "Set-Location '$backendDir'; & '$venvPython' -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
    )
    Write-Ok 'Backend window opened'
}

if (-not $BackendOnly) {
    Start-Process powershell -ArgumentList @(
        '-NoExit', '-Command',
        "Set-Location '$frontendDir'; npm run dev"
    )
    Write-Ok 'Frontend window opened'
}

Write-Host ''
Write-Host 'QuizForge is starting. Open http://localhost:5173 once both windows are ready.' -ForegroundColor Green