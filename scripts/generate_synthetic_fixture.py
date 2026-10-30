"""Generate an original two-joint skinned triangle for CPU-only regression tests."""
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT=Path(__file__).resolve().parents[1]/'packages/lesson-schema'
binary=bytearray()
views=[]
accessors=[]

def accessor(data,component,count,kind,**kwargs):
    while len(binary)%4: binary.append(0)
    offset=len(binary);binary.extend(data)
    views.append({'buffer':0,'byteOffset':offset,'byteLength':len(data)})
    accessors.append({'bufferView':len(views)-1,'componentType':component,'count':count,'type':kind,**kwargs})
    return len(accessors)-1

def floats(values): return struct.pack('<'+'f'*len(values),*values)

positions=accessor(floats([0,0,0,0,1,0,.2,1,0]),5126,3,'VEC3',min=[0,0,0],max=[.2,1,0])
joints=accessor(bytes([0,0,0,0,1,0,0,0,1,0,0,0]),5121,3,'VEC4')
weights=accessor(floats([1,0,0,0]*3),5126,3,'VEC4')
identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
inverse=identity.copy();inverse[13]=-.5
bind=accessor(floats(identity+inverse),5126,2,'MAT4')
times=accessor(floats([0,1,2]),5126,3,'SCALAR',min=[0],max=[2])
rotations=accessor(floats([0,0,0,1,0,0,math.sin(math.pi/4),math.cos(math.pi/4),0,0,0,1]),5126,3,'VEC4')
document={'asset':{'version':'2.0','generator':'Form original synthetic test fixture'},'scene':0,
 'scenes':[{'nodes':[0,2]}],'nodes':[{'name':'hips','children':[1]},{'name':'arm','translation':[0,.5,0]},{'name':'synthetic-triangle','mesh':0,'skin':0}],
 'skins':[{'inverseBindMatrices':bind,'joints':[0,1],'skeleton':0}],
 'meshes':[{'primitives':[{'attributes':{'POSITION':positions,'JOINTS_0':joints,'WEIGHTS_0':weights}}]}],
 'animations':[{'name':'Synthetic turn','samplers':[{'input':times,'output':rotations,'interpolation':'LINEAR'}],'channels':[{'sampler':0,'target':{'node':1,'path':'rotation'}}]}],
 'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
encoded=json.dumps(document,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
binary+=b'\0'*((-len(binary))%4)
glb=struct.pack('<III',0x46546c67,2,12+8+len(encoded)+8+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
(ROOT/'synthetic.glb').write_bytes(glb)
landmarks=b'{"synthetic":true,"times":[0,1,2],"note":"No human inference; animation parser fixture only."}\n'
(ROOT/'synthetic-landmarks.json').write_bytes(landmarks)
fixture=json.loads((ROOT/'fixture.json').read_text())
for name,data,key in [('animation',glb,'fixture/synthetic.glb'),('landmarks',landmarks,'fixture/synthetic-landmarks.json')]:
    fixture[name].update(key=key,bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
(ROOT/'fixture.json').write_text(json.dumps(fixture,indent=2)+'\n')
print('Generated original synthetic skin/animation and updated fixture hashes.')
