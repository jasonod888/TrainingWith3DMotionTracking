$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path '.venv-saas/Scripts/python.exe')) { throw 'Create .venv-saas and install apps/api/requirements.txt first. See docs/saas-development.md.' }
if (-not (Test-Path 'apps/web/dist/index.html')) { throw 'Build apps/web with npm run build first.' }
if (-not (Test-Path '.env')) { throw 'Copy .env.example to .env and start the development services first.' }
$env:PORT = '8001'
& .venv-saas/Scripts/python.exe -m apps.api.serve
