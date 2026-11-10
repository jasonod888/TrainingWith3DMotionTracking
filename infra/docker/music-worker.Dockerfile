# Isolated music worker image (transport + verified profile).
# The model is NOT built into this image. Mount approved artifacts read-only.
FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home worker

WORKDIR /app
COPY infra/docker/music-requirements-lock.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY scripts/music_worker.py scripts/music_run_profile.py scripts/music_transcription.py /app/

USER worker
ENTRYPOINT ["python", "-u", "/app/music_worker.py"]
