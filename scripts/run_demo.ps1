param(
    [string]$Video = '',
    [string]$Output = 'outputs/demo',
    [switch]$FullHands
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not $Video) { $Video = 'inputs/demo_15s.mp4' }
if (-not (Test-Path -LiteralPath $Video)) { throw "Video not found: $Video" }
if (-not (Test-Path 'models/sam-3d-body-dinov3/model.ckpt')) {
    throw 'SAM weights are missing. Run scripts/download_models.py, or add --verified-mirror for the hash-checked public redistribution.'
}
$mode = 'body'
if ($FullHands) { $mode = 'full' }
& .venv/Scripts/python.exe scripts/check_environment.py
if ($LASTEXITCODE) { throw 'Environment check failed.' }
# The fixed box below is specific to the supplied Taegeuk demonstration clip.
$crop = @()
if ($Video -eq 'inputs/demo_15s.mp4') { $crop = @('--bbox', '190', '70', '470', '330') }
& .venv/Scripts/python.exe scripts/process_video.py $Video --duration 15 --fps 15 --output $Output --inference-type $mode @crop
if ($LASTEXITCODE) { throw 'Video inference failed. Per-frame files may be available for diagnosis.' }
& .venv/Scripts/python.exe scripts/export_glb.py "$Output/motion.npz"
if ($LASTEXITCODE) { throw 'GLB export failed; raw motion data is preserved.' }
& .venv/Scripts/python.exe scripts/export_glb.py "$Output/motion.npz" --smooth 0.75 --output "$Output/motion_smoothed.glb"
if ($LASTEXITCODE) { throw 'Smoothed GLB export failed; raw animation is preserved.' }
