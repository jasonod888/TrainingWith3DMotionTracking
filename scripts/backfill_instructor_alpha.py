"""Attach a transparent companion to an already published focused instructor video.

New conversions get one from the exporter's matte. This backfill is for lessons made
before that existed: the opaque render already sits on the known neutral background,
so the background can be removed here. It is an approximation of the original matte,
not a replacement for a reconversion.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sqlalchemy import select
from sqlalchemy.orm import Session
from apps.api.config import Settings
from apps.api.database import LessonAsset, LessonRevision, make_engine
from apps.api.storage import storage_client

# The exporter composites the person onto this neutral colour (BGR, as OpenCV reads it).
BACKGROUND = (37, 46, 24)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def encode_alpha(source, target, tolerance):
    """Remove the flat background where, and only where, it reaches the frame edge.

    A plain colour key also eats dark clothing: the neutral background is dark, and
    compressed black trousers sit close to it. The outlined export keeps a white rim
    between the person and the border, so a border-connected fill removes the
    background and leaves the body, belt and hair intact.
    """
    import cv2
    import numpy as np

    capture = cv2.VideoCapture(str(source))
    process = None
    try:
        if not capture.isOpened():
            raise SystemExit('Could not read the focused video.')
        fps = capture.get(cv2.CAP_PROP_FPS) or 15
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        process = subprocess.Popen(
            ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba',
             '-s', f'{width}x{height}', '-r', str(fps), '-i', '-', '-an',
             '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28',
             '-row-mt', '1', '-cpu-used', '4', '-auto-alt-ref', '0', str(target)],
            stdin=subprocess.PIPE)
        background = np.array(BACKGROUND, dtype=np.int16)
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            distance = np.abs(frame.astype(np.int16) - background).max(axis=2)
            flat = (distance <= tolerance).astype(np.uint8)
            _, labels = cv2.connectedComponents(flat, connectivity=4)
            edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
            outer = np.isin(labels, np.unique(edge[edge != 0]))
            alpha = np.where(outer, 0, 255).astype(np.uint8)
            # One pass of smoothing only softens the new boundary; the interior stays 255.
            alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
            rgba = np.empty((height, width, 4), dtype=np.uint8)
            rgba[..., :3] = frame[..., ::-1]
            rgba[..., 3] = alpha
            process.stdin.write(rgba.tobytes())
    finally:
        capture.release()
        if process is not None:
            try:
                process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            process.wait()
    if process is None or process.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        raise SystemExit('Alpha encode failed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lesson', required=True)
    parser.add_argument('--tolerance', type=int, default=18, help='Background colour distance, 0-255.')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    settings = Settings()
    engine = make_engine(settings.sqlalchemy_url)
    store = storage_client(settings)
    with Session(engine) as session:
        revision = session.scalar(select(LessonRevision).where(LessonRevision.lesson_id == args.lesson)
                                  .order_by(LessonRevision.version.desc()))
        if not revision:
            sys.exit('Lesson revision not found.')
        manifest = json.loads(json.dumps(revision.manifest))
        focused = manifest.get('focused_video')
        if not focused:
            sys.exit('This lesson has no focused instructor video.')
        key = f"lessons/{args.lesson}/instructor-alpha.webm"
        name = Path(focused['key']).name
        print(f"focused: {focused['key']}  ({focused['bytes']} bytes)")
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / name
            body = store.get_object(Bucket=settings.storage_bucket, Key=focused['key'])['Body']
            try:
                source.write_bytes(body.read())
            finally:
                body.close()
            target = Path(folder) / 'instructor-alpha.webm'
            encode_alpha(source, target, args.tolerance)
            asset = {'key': key, 'mime': 'video/webm', 'bytes': target.stat().st_size, 'sha256': digest(target)}
            print(f"alpha:   {key}  ({asset['bytes']} bytes)")
            if args.dry_run:
                print('Dry run: nothing uploaded or saved.')
                return
            store.upload_file(str(target), settings.storage_bucket, key, ExtraArgs={'ContentType': 'video/webm'})
        manifest['focused_video_alpha'] = asset
        revision.manifest = manifest
        existing = session.scalar(select(LessonAsset).where(LessonAsset.key == key, LessonAsset.lesson_id == args.lesson))
        if existing:
            existing.mime, existing.bytes, existing.sha256 = asset['mime'], asset['bytes'], asset['sha256']
        else:
            session.add(LessonAsset(lesson_id=args.lesson, **asset))
        session.commit()
        print('Saved. "Together" is available for the real instructor on this lesson.')


if __name__ == '__main__':
    main()
