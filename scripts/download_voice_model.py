"""Download the official small English Vosk model for the app's voice service."""
from pathlib import Path
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
if __name__=='__main__':
    destination=ROOT/'models';destination.mkdir(exist_ok=True)
    archive=destination/'vosk-small-en.zip'
    urllib.request.urlretrieve('https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip',archive)
    with zipfile.ZipFile(archive) as zipped:
        for item in zipped.infolist():
            if not (destination/item.filename).resolve().is_relative_to(destination.resolve()):
                raise ValueError('Unsafe model archive path.')
        zipped.extractall(destination)
    print('Local English voice model is ready.')
