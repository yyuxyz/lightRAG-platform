from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import httpx

from app.core.config import settings
from app.models import User


def runtime_port_for_user(user: User) -> int:
    return settings.runtime_port_base + user.id


def runtime_url_for_user(user: User) -> str:
    return f"http://127.0.0.1:{runtime_port_for_user(user)}"


def _pid_file(user: User) -> Path:
    return settings.runtime_run_dir / f"runtime-{user.workspace_id}.pid"


def _is_healthy(url: str) -> bool:
    try:
        response = httpx.get(f"{url}/health", timeout=4.0)
        return response.status_code == 200
    except httpx.HTTPError:
        return False


def ensure_runtime(user: User) -> str:
    url = runtime_url_for_user(user)
    if _is_healthy(url):
        return url

    settings.runtime_logs_dir.mkdir(parents=True, exist_ok=True)
    settings.runtime_run_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    out_path = settings.runtime_logs_dir / f"runtime-{user.workspace_id}.out.log"
    err_path = settings.runtime_logs_dir / f"runtime-{user.workspace_id}.err.log"
    out = out_path.open("ab")
    err = err_path.open("ab")

    args = [
        str(settings.lightrag_server_path),
        "--host",
        "127.0.0.1",
        "--port",
        str(runtime_port_for_user(user)),
        "--workspace",
        user.workspace_id,
    ]
    proc = subprocess.Popen(
        args,
        cwd=str(settings.lightrag_app_dir),
        stdout=out,
        stderr=err,
        env=env,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    _pid_file(user).write_text(str(proc.pid), encoding="ascii")

    for _ in range(30):
        if _is_healthy(url):
            return url
        time.sleep(1)
    raise RuntimeError(f"LightRAG runtime for {user.workspace_id} did not become healthy")
