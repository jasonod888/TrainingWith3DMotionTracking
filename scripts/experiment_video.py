"""Browser-compatible source playback copy for the isolated experiment pages."""
from pathlib import Path
import subprocess


def prepare_video(source, destination):
    from ground_motion import digest
    source, destination = Path(source), Path(destination)
    marker = destination.with_suffix('.source-sha256')
    checksum = digest(source)
    if destination.is_file() and marker.is_file() and marker.read_text().strip() == checksum:
        return
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(source),
                    '-an', '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0',
                    '-cpu-used', '4', '-row-mt', '1', str(destination)], check=True)
    marker.write_text(checksum, encoding='utf-8')
