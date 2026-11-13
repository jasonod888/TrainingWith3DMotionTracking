"""Fetch bounded original SMD v2 excerpts + corrected MIDI for local research.

Uses the official archive; original WAV entries, never MIDI-rendered audio. Dataset
license applies. Excerpts are not redistributed with the application.
"""
import argparse
import hashlib
import io
import json
import struct
import urllib.request
import zipfile
import zlib
from pathlib import Path

import soundfile as sf

URL = 'https://zenodo.org/api/records/13753319/files/SMD-piano_v2.zip/content'
SIZE = 3221582754
INSPECTED = {'Chopin_Op028-01_003_20100611-SMD', 'Chopin_Op028-11_003_20100611-SMD'}


def fetch(start, length):
    request = urllib.request.Request(URL, headers={'Range': f'bytes={start}-{start + length - 1}'})
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 206:
            raise ValueError('Archive server did not honor the bounded range request.')
        return response.read(length)


class Remote(io.RawIOBase):
    def __init__(self): self.pos = 0
    def seekable(self): return True
    def tell(self): return self.pos
    def seek(self, value, whence=0):
        self.pos = value if whence == 0 else self.pos + value if whence == 1 else SIZE + value
        return self.pos
    def read(self, count=-1):
        count = SIZE - self.pos if count < 0 else count
        if not count: return b''
        data = fetch(self.pos, count); self.pos += len(data)
        return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--count', type=int, default=50)
    parser.add_argument('--seconds', type=float, default=20.)
    args = parser.parse_args()
    if not 1 <= args.count <= 50 or not 1 <= args.seconds <= 30:
        parser.error('Use 1–50 recordings and 1–30 seconds per recording.')
    args.output.mkdir(parents=True, exist_ok=True)
    archive = zipfile.ZipFile(Remote())
    entries = sorted((i for i in archive.infolist() if i.filename.startswith('wav_22050_mono/')
                      and i.filename.endswith('.wav')), key=lambda i: i.filename)[:args.count]
    manifest = {'source': URL, 'reference_version': 'SMD-v2-corrected-MIDI',
                'purpose': 'Local research only; retain dataset license.',
                'license': 'CC-BY-NC-SA-3.0', 'recordings': []}
    for index, entry in enumerate(entries):
        name = Path(entry.filename).stem
        wav, midi = args.output / (name + '.wav'), args.output / (name + '.mid')
        if not wav.exists():
            header = fetch(entry.header_offset, 30)
            name_len, extra_len = struct.unpack_from('<HH', header, 26)
            start = entry.header_offset + 30 + name_len + extra_len
            # Bounded compressed prefix suffices for 20–30 seconds of mono PCM.
            packed = fetch(start, min(entry.compress_size, int(args.seconds * 60000 + 262144)))
            raw = zlib.decompressobj(-15).decompress(packed, int((args.seconds + 1) * 44100 + 65536))
            audio, rate = sf.read(io.BytesIO(raw), frames=int(args.seconds * 22050))
            if rate != 22050 or audio.ndim != 1 or len(audio) < min(22050, args.seconds * 22050):
                raise ValueError('Unsupported or incomplete original audio excerpt.')
            sf.write(wav, audio, rate, subtype='PCM_16')
        if not midi.exists(): midi.write_bytes(archive.read(f'midi/{name}.mid'))
        split = 'training' if index < 6 else 'calibration' if index < 8 else ('diagnostic' if name in INSPECTED else 'holdout')
        manifest['recordings'].append({'performance_id': name, 'split': split,
            'audio_sha256': hashlib.sha256(wav.read_bytes()).hexdigest(),
            'midi_sha256': hashlib.sha256(midi.read_bytes()).hexdigest(),
            'archive_entry': entry.filename, 'archive_crc32': entry.CRC,
            'excerpt_seconds': args.seconds})
        (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        print(name, index + 1, '/', len(entries), flush=True)


if __name__ == '__main__': main()
