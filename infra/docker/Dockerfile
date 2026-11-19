# The browser inference model is intentionally not committed. Fetch the exact
# published Basic Pitch 0.4.0 package and extract only the checksum-verified ONNX
# artifact; the builder fails if the package or artifact identity is wrong.
FROM python:3.12-slim-bookworm AS music-model
COPY scripts/fetch_basic_pitch_browser_model.py /tmp/fetch_basic_pitch_browser_model.py
RUN python -m pip download --no-deps --dest /tmp/basic-pitch basic-pitch==0.4.0 \
    && python /tmp/fetch_basic_pitch_browser_model.py \
       --source-dir /tmp/basic-pitch --output /music.onnx

FROM node:22-bookworm-slim AS web
WORKDIR /app/apps/web
COPY apps/web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
COPY packages/ /app/packages/
COPY web/dist/pose.js web/dist/voice.js web/dist/composite.js web/dist/hand-labels.js /app/web/dist/
COPY --from=music-model /music.onnx /app/music-candidate-run/basic-pitch-0.4.0/model.onnx
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /app
COPY apps/api/requirements-lock.txt /app/apps/api/requirements-lock.txt
RUN pip install --no-cache-dir -r apps/api/requirements-lock.txt
COPY apps/__init__.py /app/apps/__init__.py
COPY apps/api/ /app/apps/api/
COPY alembic.ini /app/
COPY --from=web /app/apps/web/dist/ /app/apps/web/dist/
RUN useradd --create-home --uid 10001 form
RUN mkdir -p /app/.local/upload-tmp && chown form:form /app/.local/upload-tmp
USER form
CMD ["python", "-m", "apps.api.serve"]
