"""Prepare an exact, locally installed Kong profile; never download weights or approve a route."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from scripts import music_run_profile as profiles
from scripts import piano_rights as rights

def prepare(package,weights,output,device='cpu'):
    root=Path(__file__).resolve().parents[1]
    manifest=rights.load_manifest()
    sources=['kong-piano-inference-package','kong-piano-checkpoint-4034264']
    rights.require(manifest,sources,'hosted_inference')
    checkpoint=next(item for item in manifest['sources'] if item['id']==sources[1])
    if profiles.digest_file(weights)!=checkpoint['artifact']['sha256']:
        raise ValueError('Checkpoint is not the approved Kong artifact.')
    output.mkdir(parents=True,exist_ok=True)
    config={'onset_threshold':.3,'offset_threshold':.3,'frame_threshold':.1,'pedal_offset_threshold':.2}
    config_path=output/'config.json';config_path.write_text(json.dumps(config,sort_keys=True),encoding='utf-8')
    approval=output/'commercial-evidence.json'
    approval.write_text(json.dumps({'manifest_sha256':rights.manifest_sha256(manifest),
        'sources':[item for item in manifest['sources'] if item['id'] in sources]},indent=2),encoding='utf-8')
    code=root/'scripts/music_kong_adapter.py'
    data={'schema_version':1,'model':'kong','model_version':'0.0.6','package_version':'0.0.6',
        'sample_rate':16000,'preprocessing':'mono-pcm-s16le','device':device,
        'package_path':str(package.resolve()),'package_sha256':profiles.tree_sha256(package),
        'implementation_sha256':profiles.kong_implementation_sha256(),'runtime_versions':profiles.kong_runtime_versions(),
        'config':config,'weights_sha256':profiles.digest_file(weights),'code_sha256':profiles.digest_file(code),
        'config_sha256':profiles.digest_file(config_path),'commercial_evidence_sha256':profiles.digest_file(approval)}
    path=output/'run-profile.json';path.write_text(json.dumps(data,indent=2),encoding='utf-8')
    verified=profiles.load_kong_profile(path,weights=weights,code=code,config=config_path,approval=approval)
    (output/'verified-profile.json').write_text(json.dumps(dict(verified),indent=2),encoding='utf-8')
    return verified

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,required=True)
    parser.add_argument('--weights',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--device',choices=('cpu','cuda'),default='cpu')
    args=parser.parse_args()
    verified=prepare(args.package,args.weights,args.output,args.device)
    print(json.dumps({'profile_sha256':verified['profile_sha256'],'model':'kong','device':args.device}))

if __name__=='__main__':main()
