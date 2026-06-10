from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.db import SessionLocal, init_db
from app.routers import admin, auth, rag
from app.services.users import ensure_initial_admin


def create_app() -> FastAPI:
    app = FastAPI(title="LightRAG Platform", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(rag.router)

    @app.on_event("startup")
    def on_startup() -> None:
        init_db()
        with SessionLocal() as db:
            ensure_initial_admin(db, settings.admin_username, settings.admin_password)

    @app.get("/api/platform/health")
    def platform_health() -> dict[str, str]:
        return {
            "status": "healthy",
            "runtime_mode": "per_user_process",
            "runtime_port_base": str(settings.runtime_port_base),
        }

    static_dir = settings.static_dir
    if static_dir.exists():
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

        @app.get("/{full_path:path}")
        def spa(full_path: str) -> FileResponse:
            index_path = static_dir / "index.html"
            asset_path = static_dir / full_path
            if full_path and asset_path.exists() and asset_path.is_file():
                return FileResponse(asset_path)
            return FileResponse(index_path)

    return app


app = create_app()
