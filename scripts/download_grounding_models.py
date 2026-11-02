"""Install optional correction checkpoints; no SAM inference or application changes."""
import argparse
from pathlib import Path
import urllib.request
from huggingface_hub import hf_hub_download
from ground_motion import digest

ROOT=Path(__file__).resolve().parents[1]


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--models',type=Path,default=ROOT/'models')
    a=p.parse_args();a.models.mkdir(parents=True,exist_ok=True)
    sam=a.models/'sam2.1_hiera_small.pt'
    if not sam.exists():
        temp=sam.with_suffix('.download')
        urllib.request.urlretrieve('https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt',temp)
        temp.replace(sam)
    moge=hf_hub_download('Ruicheng/moge-2-vitb-normal','model.pt',
                         revision='ca5f0e07ff01d3e5a364c1d954ed12ee1814b368',
                         local_dir=str(a.models/'moge-2-vitb-normal'))
    print('SAM2 checkpoint SHA256:',digest(sam));print('MoGe checkpoint SHA256:',digest(moge))
