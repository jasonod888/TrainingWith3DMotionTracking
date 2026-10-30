FROM node:22-bookworm-slim AS web
WORKDIR /app/apps/web
COPY apps/web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY apps/web/ ./
COPY packages/ /app/packages/
COPY web/dist/pose.js web/dist/voice.js web/dist/composite.js web/dist/hand-labels.js /app/web/dist/
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
USER form
CMD ["python", "-m", "apps.api.serve"]
