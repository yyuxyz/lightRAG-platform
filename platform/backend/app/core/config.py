from __future__ import annotations

import os
from pathlib import Path


class Settings:
    def __init__(self) -> None:
        base_dir = Path(os.getenv("LIGHTRAG_PLATFORM_HOME", Path(__file__).resolve().parents[3]))
        self.base_dir = base_dir
        self.data_dir = Path(os.getenv("PLATFORM_DATA_DIR", base_dir / "data"))
        self.static_dir = Path(os.getenv("PLATFORM_STATIC_DIR", base_dir / "frontend" / "dist"))
        self.database_url = os.getenv(
            "PLATFORM_DATABASE_URL", f"sqlite:///{self.data_dir / 'platform.db'}"
        )
        self.jwt_secret = os.getenv("PLATFORM_JWT_SECRET", "change-this-platform-secret")
        self.jwt_algorithm = os.getenv("PLATFORM_JWT_ALGORITHM", "HS256")
        self.jwt_expire_minutes = int(os.getenv("PLATFORM_JWT_EXPIRE_MINUTES", "1440"))
        self.lightrag_base_url = os.getenv(
            "LIGHTRAG_INTERNAL_URL", "http://127.0.0.1:9622"
        ).rstrip("/")
        self.lightrag_root = Path(os.getenv("LIGHTRAG_ROOT", base_dir.parent))
        self.lightrag_app_dir = Path(
            os.getenv("LIGHTRAG_APP_DIR", self.lightrag_root / "app")
        )
        self.lightrag_server_path = Path(
            os.getenv(
                "LIGHTRAG_SERVER_PATH",
                self.lightrag_app_dir / ".venv" / "Scripts" / "lightrag-server.exe",
            )
        )
        self.runtime_port_base = int(os.getenv("LIGHTRAG_RUNTIME_PORT_BASE", "9700"))
        self.runtime_logs_dir = Path(os.getenv("PLATFORM_LOG_DIR", base_dir / "logs"))
        self.runtime_run_dir = Path(os.getenv("PLATFORM_RUN_DIR", base_dir / "run"))
        self.admin_username = os.getenv("PLATFORM_ADMIN_USERNAME", "admin")
        self.admin_password = os.getenv("PLATFORM_ADMIN_PASSWORD", "ChangeMe123!")


settings = Settings()
