$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDirectory = Join-Path $projectRoot '.zhishu-demo\logs'
$logPath = Join-Path $logDirectory 'launcher-latest.log'
$exitCode = 1

Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Content -LiteralPath $logPath -Encoding UTF8 -Value @(
    "Zhishu launcher started: $(Get-Date -Format o)"
    "Project: $projectRoot"
    ''
)

function Write-LauncherLine {
    param([AllowEmptyString()][string]$Text)
    Write-Host $Text
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $Text
}

try {
    $Host.UI.RawUI.WindowTitle = 'Zhishu - One-click Start'

    @(
        '================================================================'
        '  Zhishu - AI Coding Agent Control Plane'
        '================================================================'
        'Docker Desktop will be started automatically when needed.'
        'First launch builds the project; later launches reuse it.'
        ''
    ) | ForEach-Object { Write-LauncherLine $_ }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js 22+ was not found in PATH.'
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'npm was not found in PATH.'
    }

    & npm.cmd run zhishu:start 2>&1 | ForEach-Object {
        Write-LauncherLine $_.ToString()
    }
    $launcherExitCode = $LASTEXITCODE
    if ($launcherExitCode -ne 0) {
        throw "Zhishu launcher exited with code $launcherExitCode."
    }

    $readyMessage = "`n[READY] Zhishu is running:`nhttp://127.0.0.1:3001"
    Write-Host $readyMessage -ForegroundColor Green
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $readyMessage
    $exitCode = 0
}
catch {
    $failureMessage = @(
        ''
        "[FAIL] $($_.Exception.Message)"
        "Detailed log: $logPath"
        'Fix the message above, then double-click start.bat again.'
    ) -join "`n"
    Write-Host $failureMessage -ForegroundColor Red
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value $failureMessage
}
finally {
    Write-Host ''
    if ($exitCode -eq 0) {
        Read-Host 'Press Enter to close this window'
    }
    else {
        Read-Host 'Startup failed. Press Enter only after reading the error'
    }
}

exit $exitCode
