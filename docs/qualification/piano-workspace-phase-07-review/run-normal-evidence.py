"""Rerun submitted route/library/video evidence without overwriting its captures."""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
source=ROOT/'docs/qualification/piano-workspace-phase-07/scripts/check-normal-route.py'
spec=importlib.util.spec_from_file_location('review_phase7_normal',source)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.OUT=Path(__file__).parent/'normal-captures'
module.OUT.mkdir(parents=True,exist_ok=True)
module.__file__=str(Path(__file__).parent/'scripts/check-normal-route.py')
raise SystemExit(module.main())
