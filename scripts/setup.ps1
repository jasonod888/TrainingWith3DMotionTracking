$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path '.venv/Scripts/python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE) { throw 'Could not create Python environment.' }
}
if (-not (Test-Path 'vendor/sam-3d-body/.git')) {
    git clone https://github.com/facebookresearch/sam-3d-body.git vendor/sam-3d-body
    if ($LASTEXITCODE) { throw 'Could not download SAM 3D Body.' }
    git -C vendor/sam-3d-body checkout b5c765a0d89d789985e186d396315e7590887b94
    if ($LASTEXITCODE) { throw 'Could not select the tested SAM source revision.' }
}
if (-not (Test-Path 'vendor/dinov3/.git')) {
    git clone https://github.com/facebookresearch/dinov3.git vendor/dinov3
    if ($LASTEXITCODE) { throw 'Could not download DINOv3.' }
    git -C vendor/dinov3 checkout 6876159a11b4df116f30f667f8c9888617df0751
    if ($LASTEXITCODE) { throw 'Could not select the local DINOv3 revision.' }
}
& .venv/Scripts/python.exe -m pip install torch==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE) { throw 'CUDA PyTorch installation failed.' }
& .venv/Scripts/python.exe -m pip install -r requirements.txt
if ($LASTEXITCODE) { throw 'Dependency installation failed.' }
& .venv/Scripts/python.exe scripts/check_environment.py
if ($LASTEXITCODE) { throw 'Environment check failed.' }
