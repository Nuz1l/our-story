$ErrorActionPreference = "Stop"

$pidsFile = Join-Path $PSScriptRoot "logs\processes.json"
if (Test-Path -LiteralPath $pidsFile) {
    $ids = Get-Content -Raw -LiteralPath $pidsFile | ConvertFrom-Json
    foreach ($name in @("frontend", "scheduler", "backend")) {
        $property = $ids.PSObject.Properties[$name]
        if ($property) { Stop-Process -Id $property.Value -ErrorAction SilentlyContinue }
    }
    Remove-Item -LiteralPath $pidsFile
}

$pgCtl = "C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe"
$pgData = Join-Path $env:LOCALAPPDATA "OurMemories\postgres-data"
if (Test-Path -LiteralPath $pgData) {
    & $pgCtl -D $pgData status *> $null
    if ($LASTEXITCODE -eq 0) { & $pgCtl -D $pgData -m fast -w stop }
}
Write-Output "Сайт и локальная база остановлены"
