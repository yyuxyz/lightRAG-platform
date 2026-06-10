from __future__ import annotations

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
