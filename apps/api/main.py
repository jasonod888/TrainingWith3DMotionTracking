from contextlib import asynccontextmanager
import json
import logging
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from .config import Settings, ROOT
from .contracts import LessonManifest
from .database import make_engine, database_ready
from .storage import check_storage

logger = logging.getLogger('form')

def create_app(settings: Settings | None = None):
    settings = settings or Settings()
    engine = make_engine(settings.sqlalchemy_url)

    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()

    app = FastAPI(title='Form', version='0.1.0', lifespan=lifespan)

    @app.get('/health/live')
    def live():
        return {'status':'ok'}

    @app.get('/health/ready')
    def ready():
        try:
            database_ready(engine)
            check_storage(settings)
        except Exception:
            logger.exception('Readiness check failed')
            return JSONResponse({'status':'unavailable'}, status_code=503)
        return {'status':'ready'}

    def demo_manifest():
        path = settings.demo_assets_dir / 'manifest.json'
        if not settings.demo_enabled or not path.is_file():
            raise HTTPException(404, 'Demonstration unavailable')
        return LessonManifest.model_validate_json(path.read_text(encoding='utf-8'))

    @app.get('/api/demo', response_model=LessonManifest)
    def demo():
        return demo_manifest()

    @app.get('/api/demo/assets/{name}')
    def demo_asset(name: str):
        manifest = demo_manifest()
        assets = {Path(a.key).name:a for a in [manifest.animation, manifest.landmarks, manifest.source_video, manifest.thumbnail] if a}
        if name not in assets:
            raise HTTPException(404)
        path = settings.demo_assets_dir / name
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(path, media_type=assets[name].mime, headers={'Cache-Control':'private, max-age=300'})

    @app.get('/api/capabilities')
    def capabilities():
        return {'phase':0, 'demo':settings.demo_enabled, 'accounts':False, 'conversion':False, 'sharing':False}

    @app.get('/api/{path:path}', include_in_schema=False)
    def missing_api(path: str):
        raise HTTPException(404)

    if settings.web_dist_dir.is_dir():
        app.mount('/', StaticFiles(directory=settings.web_dist_dir, html=True), name='web')
    return app

app = create_app()
