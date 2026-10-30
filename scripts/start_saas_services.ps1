param(
    [ValidatePattern('^$|^[A-Za-z]$')][string]$DockerDataDrive = '',
    [switch]$Gpu,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not $DockerDataDrive) {
    $formDockerSettingsPath = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Docker/settings-store.json'
    if (Test-Path -LiteralPath $formDockerSettingsPath) {
        $formDockerSettings = Get-Content -LiteralPath $formDockerSettingsPath -Raw | ConvertFrom-Json
        if ($formDockerSettings.CustomWslDistroDir) {
            $DockerDataDrive = [System.IO.Path]::GetPathRoot($formDockerSettings.CustomWslDistroDir).Substring(0, 1)
        }
    }
    if (-not $DockerDataDrive) { $DockerDataDrive = [System.IO.Path]::GetPathRoot([Environment]::SystemDirectory).Substring(0, 1) }
}
$formMinimumGB = if ($Gpu) { 25 } else { 10 }
$formVolume = [System.IO.DriveInfo]::new($DockerDataDrive + ':\')
if (-not $formVolume.IsReady) { throw 'The configured Docker data drive is unavailable.' }
if ($formVolume.AvailableFreeSpace -lt ($formMinimumGB * 1GB)) {
    throw ('Docker data drive {0}: has only {1:N1} GB free. Free at least {2} GB or relocate Docker data before starting services.' -f $DockerDataDrive, ($formVolume.AvailableFreeSpace / 1GB), $formMinimumGB)
}
Write-Output ('Disk preflight passed: {0}: has {1:N1} GB free.' -f $DockerDataDrive, ($formVolume.AvailableFreeSpace / 1GB))
if ($CheckOnly) { return }
docker compose config --quiet
if ($LASTEXITCODE) { throw 'Compose configuration is invalid.' }
docker compose up -d postgres storage mail
if ($LASTEXITCODE) { throw 'Could not start the local services.' }
