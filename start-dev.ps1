<#
.SYNOPSIS
  Starts the OpenInspection local dev server (Vite + Cloudflare Workers emulation)
  and opens a browser pointed at it once it's actually ready to accept requests.

.PARAMETER Path
  Optional path/route to open once the server is up (e.g. "/library/templates").
  Defaults to the root.

.EXAMPLE
  .\start-dev.ps1
  .\start-dev.ps1 -Path "/library/templates"
#>

param(
    [string]$Path = "/"
)

$ErrorActionPreference = 'Stop'

$RepoPath = $PSScriptRoot
$Port     = 5173
$Url      = "http://localhost:$Port$Path"

function Test-PortOpen {
    param([int]$PortToCheck)
    $result = Test-NetConnection -ComputerName 'localhost' -Port $PortToCheck -WarningAction SilentlyContinue -InformationLevel Quiet
    return $result
}

Set-Location $RepoPath

if (Test-PortOpen -PortToCheck $Port) {
    Write-Host "A server is already listening on port $Port — skipping startup." -ForegroundColor Yellow
}
else {
    Write-Host "Starting OpenInspection dev server (npm run dev:hmr)..." -ForegroundColor Cyan

    # npm on Windows is npm.cmd, not a real .exe — launch it via cmd.exe so
    # Start-Process can find and run it, in its own visible window so you can
    # see build output / errors.
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'npm run dev:hmr' `
        -WorkingDirectory $RepoPath `
        -WindowStyle Normal

    Write-Host "Waiting for it to come up on port $Port..." -ForegroundColor Cyan
    $maxWaitSeconds = 90
    $elapsed = 0
    $ready = $false

    while ($elapsed -lt $maxWaitSeconds) {
        if (Test-PortOpen -PortToCheck $Port) {
            $ready = $true
            break
        }
        Start-Sleep -Seconds 2
        $elapsed += 2
        Write-Host "  ...still waiting ($elapsed s)" -ForegroundColor DarkGray
    }

    if (-not $ready) {
        Write-Warning "Server didn't respond within $maxWaitSeconds seconds. Check the new terminal window for errors before opening the browser."
        exit 1
    }

    Write-Host "Server is up after $elapsed s." -ForegroundColor Green
}

Write-Host "Opening $Url" -ForegroundColor Cyan
Start-Process $Url
