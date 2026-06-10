from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, User
from app.security import hash_password, verify_password


def workspace_for_user_id(user_id: int) -> str:
    return f"user_{user_id}"


def create_user(db: Session, username: str, password: str, role: str = "user") -> User:
    existing = db.scalar(select(User).where(User.username == username))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    user = User(
        username=username,
        password_hash=hash_password(password),
        role=role if role in {"admin", "user"} else "user",
        status="active",
        workspace_id="pending",
    )
    db.add(user)
    db.flush()
    user.workspace_id = workspace_for_user_id(user.id)
    db.add(AuditLog(actor_user_id=None, action="user.created", target_type="user", target_id=str(user.id)))
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.username == username))
    if not user or user.status != "active":
        return None
    if not verify_password(password, user.password_hash):
        return None
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def ensure_initial_admin(db: Session, username: str, password: str) -> None:
    has_user = db.scalar(select(User.id).limit(1))
    if has_user:
        return
    create_user(db, username=username, password=password, role="admin")
