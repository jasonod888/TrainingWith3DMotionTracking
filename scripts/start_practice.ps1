$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
& .venv/Scripts/python.exe scripts/serve_practice.py
if ($LASTEXITCODE) { throw 'Could not start the practice server.' }
