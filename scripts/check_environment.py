"""Check the actual local CUDA runtime, imports, and model prerequisites."""
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'vendor' / 'sam-3d-body'))
os.environ['MOMENTUM_ENABLED'] = '0'  # Use official TorchScript MHR during inference.
os.environ['TORCH_HOME'] = str(ROOT / 'models' / 'torch')

def main():
    import torch
    if not torch.cuda.is_available():
        raise SystemExit('CUDA is unavailable. Run scripts/setup.ps1 with the CUDA wheel index.')
    x = torch.ones(16, device='cuda')
    assert x.sum().item() == 16
    from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body
    import pymomentum.geometry
    import cv2
    info = {
        'python': sys.version.split()[0], 'torch': torch.__version__,
        'cuda_runtime': torch.version.cuda, 'gpu': torch.cuda.get_device_name(0),
        'vram_gib': round(torch.cuda.get_device_properties(0).total_memory / 2**30, 2),
        'sam_import': True, 'pymomentum_import': True,
        'checkpoint_present': (ROOT / 'models/sam-3d-body-dinov3/model.ckpt').is_file(),
        'input_videos': [p.name for p in (ROOT / 'inputs').glob('*') if p.suffix.lower() in ('.mp4', '.mov')],
    }
    (ROOT / 'outputs').mkdir(exist_ok=True)
    (ROOT / 'outputs/environment.json').write_text(json.dumps(info, indent=2))
    print(json.dumps(info, indent=2))

if __name__ == '__main__':
    main()
