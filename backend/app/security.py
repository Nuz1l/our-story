from __future__ import annotations

import hashlib
import secrets
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import SessionToken, User


hasher = PasswordHasher()
ACCESS_MINUTES = 15
REFRESH_DAYS = 14
_attempts: dict[str, list[float]] = {}


def hash_password(password: str) -> str:
    return hasher.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    try:
        return hasher.verify(encoded, password)
    except (VerifyMismatchError, ValueError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def check_login_rate_limit(key: str) -> None:
    now = time.monotonic()
    recent = [t for t in _attempts.get(key, []) if now - t < 300]
    if len(recent) >= 8:
        raise HTTPException(429, "Слишком много попыток. Повторите через пять минут.")
    recent.append(now)
    _attempts[key] = recent


def clear_login_rate_limit(key: str) -> None:
    _attempts.pop(key, None)


def issue_session(db: Session, user: User, response: Response) -> None:
    refresh = secrets.token_urlsafe(48)
    session = SessionToken(
        id=uuid4(), user_id=user.id, token_hash=token_hash(refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(days=REFRESH_DAYS),
    )
    db.add(session)
    db.commit()
    _set_cookies(response, user, session.id, refresh)


def rotate_session(db: Session, session: SessionToken, user: User, response: Response) -> None:
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()
    issue_session(db, user, response)


def _set_cookies(response: Response, user: User, session_id: UUID, refresh: str) -> None:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_MINUTES)
    access = jwt.encode({"sub": str(user.id), "sid": str(session_id), "exp": expires, "type": "access"}, settings.jwt_secret, algorithm="HS256")
    csrf = secrets.token_urlsafe(32)
    options = {"secure": settings.cookie_secure, "samesite": "lax"}
    response.set_cookie("access_token", access, httponly=True, max_age=ACCESS_MINUTES * 60, path="/", **options)
    response.set_cookie("refresh_token", refresh, httponly=True, max_age=REFRESH_DAYS * 86400, path="/api/auth", **options)
    response.set_cookie("csrf_token", csrf, httponly=False, max_age=REFRESH_DAYS * 86400, path="/", **options)


def clear_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/auth")
    response.delete_cookie("csrf_token", path="/")


def csrf_protect(request: Request) -> None:
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    cookie = request.cookies.get("csrf_token")
    header = request.headers.get("x-csrf-token")
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise HTTPException(403, "Неверный CSRF-токен")


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get("access_token")
    if not token:
        return None
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        if payload.get("type") != "access":
            return None
        user = db.get(User, UUID(payload["sub"]))
        session = db.get(SessionToken, UUID(payload["sid"]))
        if not user or not user.is_active or not session or session.user_id != user.id or session.revoked_at:
            return None
        return user
    except (jwt.PyJWTError, ValueError, KeyError):
        return None


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Необходим вход в аккаунт")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.access_granted or user.role not in {"admin", "super_admin"}:
        raise HTTPException(403, "Недостаточно прав")
    return user


def super_admin_user(user: User = Depends(current_user)) -> User:
    if not user.access_granted or user.role != "super_admin":
        raise HTTPException(403, "Недостаточно прав")
    return user

