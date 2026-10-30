param(
    [ValidatePattern('^[A-Za-z]$')][string]$DockerDataDrive = 'C',
    [switch]$Gpu,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
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
