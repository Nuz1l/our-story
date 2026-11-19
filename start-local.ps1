$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$node = (Get-Command node.exe -ErrorAction Stop).Source
$pgCtl = "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe"
$pgData = Join-Path $env:LOCALAPPDATA "OurMemories\postgres-data"
$pgLog = Join-Path $env:LOCALAPPDATA "OurMemories\postgres.log"
$logs = Join-Path $root "logs"
$pidsFile = Join-Path $logs "processes.json"

if (-not (Test-Path -LiteralPath (Join-Path $root ".env"))) { throw "Нет .env в папке проекта" }
if (-not (Test-Path -LiteralPath $python)) { throw "Не найдено окружение Python: $python" }
if (-not (Test-Path -LiteralPath $pgData)) { throw "Не найдена локальная база PostgreSQL: $pgData" }
New-Item -ItemType Directory -Path $logs -Force | Out-Null

& $pgCtl -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
    & $pgCtl -D $pgData -o "-p 55432 -h 127.0.0.1" -l $pgLog -w start
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL не запустилась; проверьте $pgLog" }
}

$existing = if (Test-Path -LiteralPath $pidsFile) { Get-Content -Raw -LiteralPath $pidsFile | ConvertFrom-Json } else { $null }
$ids = @{}

function Start-LocalProcess([string]$name, [string]$file, [string[]]$arguments, [string]$workingDirectory) {
    $previous = if ($existing -and $existing.PSObject.Properties[$name]) { $existing.PSObject.Properties[$name].Value } else { $null }
    if ($previous -and (Get-Process -Id $previous -ErrorAction SilentlyContinue)) {
        $ids[$name] = [int]$previous
        return
    }
    $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workingDirectory `
        -RedirectStandardOutput (Join-Path $logs "$name.out.log") `
        -RedirectStandardError (Join-Path $logs "$name.err.log") `
        -WindowStyle Hidden -PassThru
    $ids[$name] = $process.Id
}

Start-LocalProcess "backend" $python @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001") $backend

$apiReady = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:8001/api/health" -UseBasicParsing -TimeoutSec 2
        if ($health.StatusCode -eq 200 -and $health.Content -match '"status":"ok"') {
            $apiReady = $true
            break
        }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $apiReady) { throw "FastAPI не ответил за 45 секунд. Проверьте $(Join-Path $logs 'backend.err.log')" }

Start-LocalProcess "scheduler" $python @("-m", "app.scheduler") $backend
Start-LocalProcess "frontend" $node @(".\node_modules\vite\bin\vite.js", "--host", "127.0.0.1", "--port", "5173") $frontend

$ids | ConvertTo-Json | Set-Content -LiteralPath $pidsFile -Encoding UTF8
Write-Output "Сайт: http://localhost:5173"
Write-Output "Админ-панель: http://localhost:5173/admin"
Write-Output "API: http://localhost:8001/docs"
Write-Output "Логи: $logs"
