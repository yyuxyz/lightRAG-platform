from __future__ import annotations

from pathlib import Path
from typing import Iterable

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.core.config import settings
from app.deps import get_current_user
from app.models import User
from app.services.runtime import ensure_runtime

router = APIRouter(prefix="/api", tags=["lightrag-gateway"])

BLOCKED_HEADERS = {
    "host",
    "content-length",
    "connection",
    "authorization",
    "lightrag-workspace",
}


def filtered_headers(headers: Iterable[tuple[str, str]]) -> dict[str, str]:
    return {key: value for key, value in headers if key.lower() not in BLOCKED_HEADERS}


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _is_placeholder(value: str | None) -> bool:
    if not value:
        return True
    normalized = value.strip().lower()
    return normalized in {"your_api_key", "your-api-key", "api_key", "sk-xxx"} or normalized.startswith("your_")


def _needs_api_key(binding: str | None) -> bool:
    return (binding or "").strip().lower() in {"openai", "azure_openai", "gemini", "jina", "voyageai"}


def _mask_key(value: str | None) -> str:
    if not value:
        return ""
    if _is_placeholder(value):
        return value
    return "***masked***"


@router.get("/rag/config")
async def rag_config(
    user: User = Depends(get_current_user),
) -> dict[str, object]:
    env_values = _read_env_file(settings.lightrag_app_dir / ".env")
    llm_binding = env_values.get("LLM_BINDING", "")
    embedding_binding = env_values.get("EMBEDDING_BINDING", "")
    llm_key = env_values.get("LLM_BINDING_API_KEY") or env_values.get("OPENAI_API_KEY")
    embedding_key = env_values.get("EMBEDDING_BINDING_API_KEY") or env_values.get("OPENAI_API_KEY")
    issues: list[str] = []

    if _needs_api_key(llm_binding) and _is_placeholder(llm_key):
        issues.append("LLM API Key 未配置或仍为示例值 your_api_key")
    if _needs_api_key(embedding_binding) and _is_placeholder(embedding_key):
        issues.append("Embedding API Key 未配置或仍为示例值 your_api_key")

    return {
        "status": "valid" if not issues else "invalid",
        "workspace_id": user.workspace_id,
        "issues": issues,
        "llm": {
            "binding": llm_binding,
            "host": env_values.get("LLM_BINDING_HOST", ""),
            "model": env_values.get("LLM_MODEL", ""),
            "api_key": _mask_key(llm_key),
        },
        "embedding": {
            "binding": embedding_binding,
            "host": env_values.get("EMBEDDING_BINDING_HOST", ""),
            "model": env_values.get("EMBEDDING_MODEL", ""),
            "api_key": _mask_key(embedding_key),
        },
    }


async def proxy_to_lightrag(request: Request, path: str, user: User) -> Response:
    try:
        runtime_url = ensure_runtime(user)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    target = f"{runtime_url}/{path.lstrip('/')}"
    query = request.url.query
    if query:
        target = f"{target}?{query}"
    body = await request.body()
    headers = filtered_headers(request.headers.items())
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            upstream = await client.request(
                request.method,
                target,
                content=body,
                headers=headers,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"LightRAG runtime unavailable: {exc}") from exc

    response_headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in {"content-encoding", "transfer-encoding", "connection"}
    }
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )


@router.get("/rag/health")
async def rag_health(
    request: Request,
    user: User = Depends(get_current_user),
) -> Response:
    return await proxy_to_lightrag(request, "health", user)


@router.api_route("/lightrag/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def lightrag_gateway(
    path: str,
    request: Request,
    user: User = Depends(get_current_user),
) -> Response:
    return await proxy_to_lightrag(request, path, user)
