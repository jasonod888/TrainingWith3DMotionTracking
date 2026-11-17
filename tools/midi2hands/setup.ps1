<#
.SYNOPSIS
  Download and verify the pinned midi2hands ONNX artifact.
.DESCRIPTION
  This script is optional and project-local: it writes only into tools/midi2hands.
  It does not install packages, download datasets or touch global model paths.
#>
param(
  [string]$Destination = (Join-Path $PSScriptRoot 'model.onnx')
)
$ErrorActionPreference = 'Stop'
$url = 'https://raw.githubusercontent.com/pianoviz/midi2hands/78e546b520144b301de5e793ceb83be61356a65d/src/midi2hands/models/onnex/model.onnx'
$expectedBytes = 252047
$expectedHash = '6b7a7858a881e9e231bb3aeeecc1480c9b43a816f4ea2cac2182dc34b44e18dd'

$directory = Split-Path -Parent $Destination
if (-not (Test-Path -LiteralPath $directory)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
if (-not (Test-Path -LiteralPath $Destination)) {
  Invoke-WebRequest -Uri $url -OutFile $Destination -UseBasicParsing
}
$bytes = (Get-Item -LiteralPath $Destination).Length
$hash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
if ($bytes -ne $expectedBytes -or $hash -ne $expectedHash) {
  Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
  throw "midi2hands model verification failed: size=$bytes hash=$hash"
}
Write-Output "Verified midi2hands model: $Destination ($bytes bytes, sha256 $hash)"
