from __future__ import annotations

import asyncio
import io
import os
import re
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import (AuditLog, Bookmark, Category, Comment, CommentLike, Invitation, Media,
                        ModerationHistory, Post, PostLike, PostMedia, Profile, SessionToken, SiteSetting, User, now)
from app.schemas import (AcceptInvitationIn, CategoryIn, CommentIn, CommentPatch, InvitationIn, OwnProfilePatch,
                         LoginIn, PasswordChangeIn, PostIn, PostPatch, ProfileIn, ProfilePatch, RegisterIn, UserPatch)
from app.security import (admin_user, check_login_rate_limit, clear_cookies, clear_login_rate_limit,
                          csrf_protect, current_user, hash_password, issue_session, optional_user,
                          rotate_session, super_admin_user, token_hash, verify_password)
from app.services import (DEFAULT_SETTINGS, apply_post_data, as_utc, can_see_post, comment_dict, is_admin,
                          post_dict, profile_dict, publish_due, require_post, settings_dict)


settings = get_settings()
_request_buckets: dict[str, list[float]] = {}
app = FastAPI(title="Our Memories API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_origin], allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token"])


@app.middleware("http")
async def safety_headers(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin and origin != settings.frontend_origin:
            return JSONResponse({"detail": "Недоверенный источник запроса"}, status_code=403)
        path = request.url.path
        category = "uploads" if path.startswith("/api/admin/media") else "comments" if "/comments" in path else "writes"
        limit, window = (600, 300) if category == "uploads" else (60, 60) if category == "comments" else (300, 60)
        access_cookie = request.cookies.get("access_token")
        identity = token_hash(access_cookie)[:16] if access_cookie else "guest"
        key = f"{request.client.host if request.client else 'unknown'}:{identity}:{category}"
        moment = time.monotonic()
        recent = [stamp for stamp in _request_buckets.get(key, []) if moment - stamp < window]
        if len(recent) >= limit:
            return JSONResponse({"detail": "Слишком много запросов. Повторите позже."}, status_code=429)
        recent.append(moment)
        _request_buckets[key] = recent
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


def audit(db: Session, user: User | None, action: str, kind: str, entity_id: UUID | str) -> None:
    db.add(AuditLog(actor_user_id=user.id if user else None, action=action, entity_type=kind, entity_id=str(entity_id)))


def admin_post(db: Session, post_id: UUID) -> Post:
    post = db.get(Post, post_id)
    if not post or post.deleted_at:
        raise HTTPException(404, "Публикация не найдена")
    return post


def valid_comment(db: Session, comment_id: UUID, user: User | None) -> Comment:
    comment = db.get(Comment, comment_id)
    if not comment or comment.deleted_at:
        raise HTTPException(404, "Комментарий не найден")
    require_post(db, comment.post_id, user)
    if comment.moderation_status != "approved" and not is_admin(user) and comment.user_id != (user.id if user else None):
        raise HTTPException(404, "Комментарий не найден")
    return comment


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok"}


@app.get("/api/site")
def site_info(db: Session = Depends(get_db)):
    values = settings_dict(db)
    return {key: values[key] for key in DEFAULT_SETTINGS if key != "registration_enabled"} | {"registration_enabled": values["registration_enabled"]}


@app.post("/api/auth/login")
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    key = f"{request.client.host if request.client else 'unknown'}:{payload.email.lower()}"
    check_login_rate_limit(key)
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Неверный email или пароль")
    clear_login_rate_limit(key)
    issue_session(db, user, response)
    return {"id": str(user.id), "email": user.email, "display_name": user.display_name, "role": user.role, "access_granted": user.access_granted}


@app.post("/api/auth/refresh", dependencies=[Depends(csrf_protect)])
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get("refresh_token")
    session = db.scalar(select(SessionToken).where(SessionToken.token_hash == token_hash(refresh_token))) if refresh_token else None
    if not session or session.revoked_at or as_utc(session.expires_at) < now():
        clear_cookies(response)
        raise HTTPException(401, "Сессия истекла")
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "Аккаунт недоступен")
    rotate_session(db, session, user, response)
    return {"ok": True}


@app.post("/api/auth/logout", dependencies=[Depends(csrf_protect)])
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get("refresh_token")
    session = db.scalar(select(SessionToken).where(SessionToken.token_hash == token_hash(raw))) if raw else None
    if session:
        session.revoked_at = now()
        db.commit()
    clear_cookies(response)
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    profile = linked_profile(db, user)
    return {"id": str(user.id), "email": user.email, "display_name": user.display_name,
            "role": user.role, "access_granted": user.access_granted,
            "avatar_url": f"/api/media/{profile.avatar_media_id}" if profile and profile.avatar_media_id else None}


@app.post("/api/auth/change-password", dependencies=[Depends(csrf_protect)])
def change_password(payload: PasswordChangeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "Текущий пароль неверен")
    user.password_hash = hash_password(payload.new_password)
    db.query(SessionToken).filter(SessionToken.user_id == user.id).update({"revoked_at": now()})
    audit(db, user, "change_password", "user", user.id)
    db.commit()
    return {"ok": True, "message": "Войдите с новым паролем"}


def linked_profile(db: Session, user: User) -> Profile | None:
    return db.scalar(select(Profile).where(Profile.linked_user_id == user.id).order_by(Profile.created_at))


def create_linked_profile(db: Session, user: User) -> Profile:
    author_ids = db.scalars(
        select(Profile.id).join(Post, Post.author_profile_id == Profile.id)
        .where(Post.created_by_user_id == user.id, Profile.linked_user_id.is_(None),
               Profile.display_name == user.display_name).distinct()
    ).all()
    if len(author_ids) == 1:
        profile = db.get(Profile, author_ids[0])
        profile.linked_user_id = user.id
        return profile
    profile = Profile(display_name=user.display_name, username=f"user_{user.id.hex}",
                      linked_user_id=user.id, is_active=True)
    db.add(profile)
    db.flush()
    return profile


@app.get("/api/profile/me")
def my_profile(user: User = Depends(current_user), db: Session = Depends(get_db)):
    profile = linked_profile(db, user)
    return profile_dict(profile) if profile else {
        "id": None, "display_name": user.display_name, "username": f"user_{user.id.hex}",
        "avatar_url": None, "bio": "", "age": None, "instagram_url": None,
        "tiktok_url": None, "is_active": True,
    }


@app.patch("/api/profile/me", dependencies=[Depends(csrf_protect)])
def update_my_profile(payload: OwnProfilePatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.access_granted:
        raise HTTPException(403, "Доступ к профилю не предоставлен")
    data = payload.model_dump(exclude_unset=True)
    if "avatar_media_id" in data and data["avatar_media_id"] is not None:
        media = db.get(Media, data["avatar_media_id"])
        if not media or media.media_type != "image" or media.uploaded_by_user_id != user.id:
            raise HTTPException(422, "Аватар не найден")
    profile = linked_profile(db, user) or create_linked_profile(db, user)
    for key, value in data.items():
        setattr(profile, key, value)
    if "display_name" in data and data["display_name"] is not None:
        user.display_name = data["display_name"].strip()
        profile.display_name = user.display_name
    audit(db, user, "update", "profile", profile.id)
    db.commit()
    return profile_dict(profile)


@app.post("/api/profile/avatar", dependencies=[Depends(csrf_protect)])
async def upload_my_avatar(file: UploadFile = File(...), user: User = Depends(current_user),
                           db: Session = Depends(get_db)):
    if not user.access_granted:
        raise HTTPException(403, "Доступ к профилю не предоставлен")
    raw = await file.read(3 * 1024 * 1024 + 1)
    if not raw or len(raw) > 3 * 1024 * 1024:
        raise HTTPException(413, "Аватар должен быть не больше 3 МБ")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image.verify()
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(415, "Поддерживаются JPG, PNG и WebP")
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(415, "Поддерживаются JPG, PNG и WebP") from None
    saved = await store_media(raw, file.filename or "avatar.jpg", user, db)
    profile = linked_profile(db, user) or create_linked_profile(db, user)
    profile.avatar_media_id = UUID(saved["id"])
    audit(db, user, "update_avatar", "profile", profile.id)
    db.commit()
    return profile_dict(profile)


@app.get("/api/profiles")
def profiles(db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    if not (user and user.access_granted) and not settings_dict(db)["site_public"]:
        return []
    return [profile_dict(p) for p in db.scalars(select(Profile).where(Profile.is_active.is_(True)).order_by(Profile.created_at)).all()]


@app.get("/api/categories")
def categories(db: Session = Depends(get_db)):
    return [{"id": str(x.id), "name": x.name, "slug": x.slug} for x in db.scalars(select(Category).order_by(Category.name)).all()]


@app.get("/api/posts")
def list_posts(sort: str = "new", timeline_only: bool = False, limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
               author_id: UUID | None = None, category_id: UUID | None = None, event_date: str | None = None,
               db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    publish_due(db)
    if not (user and user.access_granted) and not settings_dict(db)["site_public"]:
        return {"items": [], "total": 0}
    statement = select(Post).where(Post.deleted_at.is_(None), Post.status == "published", or_(Post.published_at.is_(None), Post.published_at <= now()))
    if user and user.access_granted and not is_admin(user):
        statement = statement.where(Post.visibility.in_(["public", "invited"]))
    elif not is_admin(user):
        statement = statement.where(Post.visibility == "public")
    if timeline_only or sort in {"story", "story_new"}:
        statement = statement.where(Post.show_in_timeline.is_(True))
    if author_id:
        statement = statement.where(Post.author_profile_id == author_id)
    if category_id:
        from app.models import PostCategory
        statement = statement.join(PostCategory).where(PostCategory.category_id == category_id)
    if event_date:
        try:
            from datetime import date
            parsed = date.fromisoformat(event_date)
        except ValueError:
            raise HTTPException(422, "Неверная дата")
        statement = statement.where(Post.event_date == parsed)
    order = Post.event_date.asc().nullslast() if sort == "story" else Post.event_date.desc().nullslast() if sort == "story_new" else Post.published_at.asc() if sort == "old" else Post.is_pinned.desc(), Post.published_at.desc()
    if isinstance(order, tuple):
        statement = statement.order_by(*order)
    else:
        statement = statement.order_by(order, Post.published_at.desc())
    total = db.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0
    posts = db.scalars(statement.offset(offset).limit(limit)).all()
    return {"items": [post_dict(db, p, user) for p in posts], "total": total}


@app.get("/api/posts/{post_id}")
def get_post(post_id: UUID, db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    publish_due(db)
    return post_dict(db, require_post(db, post_id, user), user)


@app.post("/api/posts", status_code=201, dependencies=[Depends(csrf_protect)])
def create_post(payload: PostIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    post = Post(author_profile_id=payload.author_profile_id, created_by_user_id=user.id)
    db.add(post)
    apply_post_data(db, post, payload)
    audit(db, user, "create", "post", post.id)
    db.commit()
    return post_dict(db, post, user)


@app.patch("/api/posts/{post_id}", dependencies=[Depends(csrf_protect)])
def update_post(post_id: UUID, payload: PostPatch, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    post = admin_post(db, post_id)
    apply_post_data(db, post, payload)
    audit(db, user, "update", "post", post.id)
    db.commit()
    return post_dict(db, post, user)


@app.delete("/api/posts/{post_id}", dependencies=[Depends(csrf_protect)])
def delete_post(post_id: UUID, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    post = admin_post(db, post_id)
    post.deleted_at = now()
    audit(db, user, "delete", "post", post.id)
    db.commit()
    return {"ok": True}


@app.post("/api/posts/{post_id}/restore", dependencies=[Depends(csrf_protect)])
def restore_post(post_id: UUID, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    post = db.get(Post, post_id)
    if not post or not post.deleted_at:
        raise HTTPException(404, "Удалённая публикация не найдена")
    post.deleted_at = None
    audit(db, user, "restore", "post", post.id)
    db.commit()
    return post_dict(db, post, user)


@app.get("/api/posts/{post_id}/comments")
def list_comments(post_id: UUID, parent_id: UUID | None = None, limit: int = Query(20, ge=1, le=100),
                  offset: int = Query(0, ge=0), db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    require_post(db, post_id, user)
    query = select(Comment).where(Comment.post_id == post_id, Comment.parent_id == parent_id, Comment.deleted_at.is_(None))
    if not is_admin(user):
        query = query.where(or_(Comment.moderation_status == "approved", Comment.user_id == user.id if user else False))
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(Comment.created_at).offset(offset).limit(limit)).all()
    return {"items": [comment_dict(db, c, user) for c in items], "total": total}


@app.post("/api/posts/{post_id}/comments", status_code=201, dependencies=[Depends(csrf_protect)])
def create_comment(post_id: UUID, payload: CommentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    post = require_post(db, post_id, user)
    if not post.comments_enabled:
        raise HTTPException(403, "Комментарии закрыты")
    if not payload.content.strip():
        raise HTTPException(422, "Комментарий не может быть пустым")
    if post.comment_access == "selected" and not is_admin(user):
        from app.models import PostCommentPermission
        allowed = db.get(PostCommentPermission, (post_id, user.id))
        if not allowed:
            raise HTTPException(403, "Комментарии доступны выбранным участникам")
    if payload.parent_id:
        parent = valid_comment(db, payload.parent_id, user)
        if parent.post_id != post_id:
            raise HTTPException(422, "Ответ должен относиться к этой публикации")
        depth, cursor = 0, parent
        while cursor.parent_id:
            depth += 1
            if depth >= 8:
                raise HTTPException(422, "Достигнута максимальная глубина ответов")
            cursor = db.get(Comment, cursor.parent_id)
            if cursor is None:
                raise HTTPException(422, "Некорректная ветка комментариев")
    comment = Comment(post_id=post_id, user_id=user.id, parent_id=payload.parent_id,
                      content=payload.content.strip(), moderation_status="pending" if post.moderate_comments and not is_admin(user) else "approved")
    db.add(comment)
    db.flush()
    audit(db, user, "create", "comment", comment.id)
    db.commit()
    return comment_dict(db, comment, user)


@app.post("/api/comments/{comment_id}/replies", status_code=201, dependencies=[Depends(csrf_protect)])
def reply_comment(comment_id: UUID, payload: CommentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    parent = valid_comment(db, comment_id, user)
    return create_comment(parent.post_id, CommentIn(content=payload.content, parent_id=comment_id), user, db)


@app.patch("/api/comments/{comment_id}", dependencies=[Depends(csrf_protect)])
def edit_comment(comment_id: UUID, payload: CommentPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    comment = valid_comment(db, comment_id, user)
    if comment.user_id != user.id and not is_admin(user):
        raise HTTPException(403, "Можно изменить только свой комментарий")
    comment.content = payload.content.strip()
    audit(db, user, "update", "comment", comment.id)
    db.commit()
    return comment_dict(db, comment, user)


@app.delete("/api/comments/{comment_id}", dependencies=[Depends(csrf_protect)])
def delete_comment(comment_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    comment = valid_comment(db, comment_id, user)
    if comment.user_id != user.id and not is_admin(user):
        raise HTTPException(403, "Можно удалить только свой комментарий")
    comment.deleted_at = now()
    audit(db, user, "delete", "comment", comment.id)
    db.commit()
    return {"ok": True}


@app.post("/api/posts/{post_id}/like", dependencies=[Depends(csrf_protect)])
def like_post(post_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    post = require_post(db, post_id, user)
    if not post.reactions_enabled:
        raise HTTPException(403, "Реакции отключены")
    if not db.scalar(select(PostLike.id).where(PostLike.post_id == post_id, PostLike.user_id == user.id)):
        db.add(PostLike(post_id=post_id, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"liked": True}


@app.delete("/api/posts/{post_id}/like", dependencies=[Depends(csrf_protect)])
def unlike_post(post_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_post(db, post_id, user)
    db.query(PostLike).filter(PostLike.post_id == post_id, PostLike.user_id == user.id).delete()
    db.commit()
    return {"liked": False}


@app.post("/api/comments/{comment_id}/like", dependencies=[Depends(csrf_protect)])
def like_comment(comment_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    comment = valid_comment(db, comment_id, user)
    post = require_post(db, comment.post_id, user)
    if not post.reactions_enabled:
        raise HTTPException(403, "Реакции отключены")
    if not db.scalar(select(CommentLike.id).where(CommentLike.comment_id == comment_id, CommentLike.user_id == user.id)):
        db.add(CommentLike(comment_id=comment_id, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"liked": True}


@app.delete("/api/comments/{comment_id}/like", dependencies=[Depends(csrf_protect)])
def unlike_comment(comment_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    valid_comment(db, comment_id, user)
    db.query(CommentLike).filter(CommentLike.comment_id == comment_id, CommentLike.user_id == user.id).delete()
    db.commit()
    return {"liked": False}


@app.post("/api/posts/{post_id}/bookmark", dependencies=[Depends(csrf_protect)])
def bookmark_post(post_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_post(db, post_id, user)
    if not db.scalar(select(Bookmark.id).where(Bookmark.post_id == post_id, Bookmark.user_id == user.id)):
        db.add(Bookmark(post_id=post_id, user_id=user.id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return {"bookmarked": True}


@app.delete("/api/posts/{post_id}/bookmark", dependencies=[Depends(csrf_protect)])
def unbookmark_post(post_id: UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(Bookmark).filter(Bookmark.post_id == post_id, Bookmark.user_id == user.id).delete()
    db.commit()
    return {"bookmarked": False}


@app.get("/api/bookmarks")
def bookmarks(db: Session = Depends(get_db), user: User = Depends(current_user)):
    posts = db.scalars(select(Post).join(Bookmark).where(Bookmark.user_id == user.id).order_by(Post.published_at.desc())).all()
    return [post_dict(db, p, user) for p in posts if can_see_post(db, p, user)]


@app.get("/api/calendar")
def calendar(year: int = Query(..., ge=2000, le=2100), month: int = Query(..., ge=1, le=12),
             db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    if not (user and user.access_granted) and not settings_dict(db)["site_public"]:
        return []
    posts = db.scalars(select(Post).where(Post.status == "published", Post.deleted_at.is_(None),
                                          func.extract("year", Post.event_date) == year, func.extract("month", Post.event_date) == month)).all()
    counts: dict[str, int] = {}
    for post in posts:
        if can_see_post(db, post, user) and post.event_date:
            key = post.event_date.isoformat()
            counts[key] = counts.get(key, 0) + 1
    return [{"date": date, "count": count} for date, count in counts.items()]


@app.get("/api/gallery")
def gallery(limit: int = Query(100, ge=1, le=200), db: Session = Depends(get_db), user: User | None = Depends(optional_user)):
    if not (user and user.access_granted) and not settings_dict(db)["site_public"]:
        return []
    links = db.scalars(select(PostMedia).join(Post).where(Post.status == "published", Post.deleted_at.is_(None)).order_by(Post.event_date.desc()).limit(limit)).all()
    result = []
    for link in links:
        post = db.get(Post, link.post_id)
        if can_see_post(db, post, user):
            media = db.get(Media, link.media_id)
            result.append({"id": str(media.id), "post_id": str(post.id), "url": f"/api/media/{media.id}",
                           "media_type": media.media_type, "alt_text": link.alt_text, "event_date": post.event_date,
                           "author": profile_dict(db.get(Profile, post.author_profile_id))})
    return result


@app.post("/api/admin/media", status_code=201, dependencies=[Depends(csrf_protect)])
async def upload_media(file: UploadFile = File(...), user: User = Depends(admin_user), db: Session = Depends(get_db)):
    raw = await file.read(3 * 1024 * 1024 + 1)
    if len(raw) > 3 * 1024 * 1024:
        raise HTTPException(413, "Для файлов больше 3 МБ используйте загрузку частями")
    return await store_media(raw, file.filename or "upload", user, db)


async def store_media(raw: bytes, filename: str, user: User, db: Session) -> dict:
    if len(raw) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, "Файл слишком большой")
    if not raw:
        raise HTTPException(422, "Пустой файл")
    ext, mime, kind, width, height = None, None, None, None, None
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img.verify()
        with Image.open(io.BytesIO(raw)) as img:
            if img.format in {"JPEG", "PNG", "WEBP"}:
                if img.width * img.height > 40_000_000:
                    raise HTTPException(413, "Слишком большое разрешение изображения")
                ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}[img.format]
                mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[img.format]
                kind, width, height = "image", img.width, img.height
    except (UnidentifiedImageError, OSError, ValueError):
        pass
    if not kind and len(raw) > 12 and raw[4:8] == b"ftyp":
        ext, mime, kind = ".mp4", "video/mp4", "video"
    if not kind and raw[:4] == bytes.fromhex("1a45dfa3"):
        ext, mime, kind = ".webm", "video/webm", "video"
    if not kind:
        raise HTTPException(415, "Поддерживаются JPG, PNG, WebP, MP4 и WebM")
    key = f"{uuid4().hex}{ext}"
    if os.getenv("BLOB_READ_WRITE_TOKEN"):
        from vercel.blob import put_blob
        await put_blob(key, raw, access="private", content_type=mime)
    else:
        upload_dir = Path(settings.upload_dir).resolve()
        upload_dir.mkdir(parents=True, exist_ok=True)
        (upload_dir / key).write_bytes(raw)
    return save_media_record(db, user, key, filename, kind, mime, len(raw), width, height)


def save_media_record(db: Session, user: User, key: str, filename: str, kind: str, mime: str,
                      size: int, width: int | None, height: int | None) -> dict:
    media = Media(storage_key=key, media_type=kind, mime_type=mime, original_name=Path(filename).name[:255],
                  size_bytes=size, width=width, height=height, uploaded_by_user_id=user.id)
    db.add(media)
    db.flush()
    audit(db, user, "upload", "media", media.id)
    db.commit()
    return {"id": str(media.id), "url": f"/api/media/{media.id}", "media_type": kind, "mime_type": mime,
            "size_bytes": media.size_bytes, "width": width, "height": height}


CHUNK_BYTES = 2 * 1024 * 1024


class CompleteUpload(BaseModel):
    upload_id: UUID
    total: int
    filename: str = Field(min_length=1, max_length=255)


@app.post("/api/admin/media/chunk", dependencies=[Depends(csrf_protect)])
async def upload_media_chunk(upload_id: UUID = Form(...), index: int = Form(...),
                             file: UploadFile = File(...), user: User = Depends(admin_user)):
    max_chunks = (settings.max_upload_mb * 1024 * 1024 + CHUNK_BYTES - 1) // CHUNK_BYTES
    if index < 0 or index >= max_chunks:
        raise HTTPException(422, "Invalid chunk index")
    raw = await file.read(CHUNK_BYTES + 1)
    if not raw or len(raw) > CHUNK_BYTES:
        raise HTTPException(413, "Invalid chunk size")
    key = f"tmp/{user.id}/{upload_id}/{index}"
    if os.getenv("BLOB_READ_WRITE_TOKEN"):
        from vercel.blob import put_blob
        await put_blob(key, raw, access="private", content_type="application/octet-stream")
    else:
        path = Path(settings.upload_dir).resolve() / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    return {"ok": True}


@app.post("/api/admin/media/complete", status_code=201, dependencies=[Depends(csrf_protect)])
async def complete_media_upload(payload: CompleteUpload, user: User = Depends(admin_user),
                                db: Session = Depends(get_db)):
    max_chunks = (settings.max_upload_mb * 1024 * 1024 + CHUNK_BYTES - 1) // CHUNK_BYTES
    if not 1 <= payload.total <= max_chunks:
        raise HTTPException(422, "Invalid chunk count")
    prefix = f"tmp/{user.id}/{payload.upload_id}/"
    keys = [f"{prefix}{index}" for index in range(payload.total)]
    blob_storage = bool(os.getenv("BLOB_READ_WRITE_TOKEN"))
    if blob_storage:
        from vercel.blob import delete_blob, get_blob, multipart_upload_blob
        from vercel.blob.errors import BlobNotFoundError

    async def read_chunk(key: str) -> bytes:
        if blob_storage:
            try:
                return (await get_blob(key, access="private")).body
            except BlobNotFoundError:
                raise HTTPException(422, "Загрузка не завершена") from None
        path = Path(settings.upload_dir).resolve() / key
        if not path.is_file():
            raise HTTPException(422, "Загрузка не завершена")
        return path.read_bytes()

    async def discard(keys_to_delete: list[str]) -> None:
        if blob_storage:
            await delete_blob(keys_to_delete)
        else:
            for old_key in keys_to_delete:
                (Path(settings.upload_dir).resolve() / old_key).unlink(missing_ok=True)

    first = await read_chunk(keys[0])
    if not first or len(first) > CHUNK_BYTES:
        raise HTTPException(422, "Неверный фрагмент файла")
    ext = mime = kind = None
    width = height = None
    try:
        with Image.open(io.BytesIO(first)) as image:
            if image.format in {"JPEG", "PNG", "WEBP"}:
                if image.width * image.height > 40_000_000:
                    raise HTTPException(413, "Слишком большое разрешение изображения")
                ext = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp"}[image.format]
                mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[image.format]
                kind, width, height = "image", image.width, image.height
    except (UnidentifiedImageError, OSError, ValueError):
        pass
    if not kind and len(first) > 12 and first[4:8] == b"ftyp":
        ext, mime, kind = ".mp4", "video/mp4", "video"
    if not kind and first[:4] == bytes.fromhex("1a45dfa3"):
        ext, mime, kind = ".webm", "video/webm", "video"
    if not kind:
        raise HTTPException(415, "Поддерживаются JPG, PNG, WebP, MP4 и WebM")

    final_key = f"{uuid4().hex}{ext}"
    size = 0
    if blob_storage:
        async with multipart_upload_blob(final_key, access="private", content_type=mime) as upload:
            for start in range(0, payload.total, 4):
                batch_keys = keys[start:start + 4]
                later = await asyncio.gather(*(read_chunk(key) for key in batch_keys[1 if start == 0 else 0:]))
                chunks = [first, *later] if start == 0 else later
                for offset, chunk in enumerate(chunks):
                    index = start + offset
                    if not chunk or len(chunk) > CHUNK_BYTES or (index < payload.total - 1 and len(chunk) != CHUNK_BYTES):
                        raise HTTPException(422, "Неверный фрагмент файла")
                    size += len(chunk)
                    if size > settings.max_upload_mb * 1024 * 1024:
                        raise HTTPException(413, "Файл слишком большой")
                await upload.upload_part(b"".join(chunks))
                await discard(batch_keys)
    else:
        final_path = Path(settings.upload_dir).resolve() / final_key
        final_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with final_path.open("wb") as output:
                for index, key in enumerate(keys):
                    chunk = first if index == 0 else await read_chunk(key)
                    if not chunk or len(chunk) > CHUNK_BYTES or (index < payload.total - 1 and len(chunk) != CHUNK_BYTES):
                        raise HTTPException(422, "Неверный фрагмент файла")
                    size += len(chunk)
                    if size > settings.max_upload_mb * 1024 * 1024:
                        raise HTTPException(413, "Файл слишком большой")
                    output.write(chunk)
                    await discard([key])
        except BaseException:
            final_path.unlink(missing_ok=True)
            raise
    return save_media_record(db, user, final_key, payload.filename, kind, mime, size, width, height)


@app.post("/api/admin/media/cancel", dependencies=[Depends(csrf_protect)])
async def cancel_media_upload(payload: CompleteUpload, user: User = Depends(admin_user)):
    max_chunks = (settings.max_upload_mb * 1024 * 1024 + CHUNK_BYTES - 1) // CHUNK_BYTES
    if not 1 <= payload.total <= max_chunks:
        raise HTTPException(422, "Неверное число фрагментов")
    keys = [f"tmp/{user.id}/{payload.upload_id}/{index}" for index in range(payload.total)]
    if os.getenv("BLOB_READ_WRITE_TOKEN"):
        from vercel.blob import delete_blob
        await delete_blob(keys)
    else:
        for key in keys:
            (Path(settings.upload_dir).resolve() / key).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/api/media/{media_id}")
async def get_media(media_id: UUID, request: Request, db: Session = Depends(get_db),
                    user: User | None = Depends(optional_user)):
    media = db.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Файл не найден")
    allowed = is_admin(user) or bool(user and media.uploaded_by_user_id == user.id)
    if not allowed:
        site_values = settings_dict(db)
        public = site_values["site_public"]
        if ((user and user.access_granted) or public) and str(media_id) in {site_values.get("logo_media_id"), site_values.get("favicon_media_id"), site_values.get("background_media_id")}:
            allowed = True
        if ((user and user.access_granted) or public) and db.scalar(select(Profile.id).where(Profile.avatar_media_id == media_id, Profile.is_active.is_(True))):
            allowed = True
        if not allowed:
            posts = db.scalars(select(Post).join(PostMedia).where(PostMedia.media_id == media_id)).all()
            allowed = any(can_see_post(db, post, user) for post in posts)
    if not allowed:
        raise HTTPException(404, "Файл не найден")
    if os.getenv("BLOB_READ_WRITE_TOKEN"):
        range_header = request.headers.get("range")
        if media.media_type == "video" and range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
            if not match or not any(match.groups()):
                return Response(status_code=416, headers={"Content-Range": f"bytes */{media.size_bytes}"})
            if match.group(1):
                start = int(match.group(1))
                requested_end = int(match.group(2)) if match.group(2) else media.size_bytes - 1
            else:
                suffix_size = int(match.group(2))
                start = max(0, media.size_bytes - suffix_size)
                requested_end = media.size_bytes - 1
            if start >= media.size_bytes:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{media.size_bytes}"})
            end = min(requested_end, start + 4 * 1024 * 1024 - 1, media.size_bytes - 1)
            if end < start:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{media.size_bytes}"})
            import httpx
            from vercel.blob import head_blob

            blob = await head_blob(media.storage_key)
            client = httpx.AsyncClient(timeout=60)
            upstream = await client.send(client.build_request(
                "GET", blob.url, headers={
                    "Authorization": f"Bearer {os.environ['BLOB_READ_WRITE_TOKEN']}",
                    "Range": f"bytes={start}-{end}",
                }), stream=True)
            if upstream.status_code != 206:
                await upstream.aclose()
                await client.aclose()
                raise HTTPException(502, "Видео временно недоступно")

            async def range_chunks():
                try:
                    async for chunk in upstream.aiter_bytes():
                        yield chunk
                finally:
                    await upstream.aclose()
                    await client.aclose()

            return StreamingResponse(range_chunks(), status_code=206, media_type=media.mime_type,
                                     headers={"Content-Range": f"bytes {start}-{end}/{media.size_bytes}",
                                              "Content-Length": str(end - start + 1), "Accept-Ranges": "bytes",
                                              "Cache-Control": "private, no-cache", "X-Robots-Tag": "noindex"})
        from vercel.blob import stream_blob

        async def chunks():
            async with stream_blob(media.storage_key, access="private") as download:
                async for chunk in download:
                    yield chunk

        return StreamingResponse(chunks(), media_type=media.mime_type,
                                 headers={"Cache-Control": "private, no-cache", "X-Robots-Tag": "noindex"})
    path = (Path(settings.upload_dir).resolve() / media.storage_key)
    if not path.is_file():
        raise HTTPException(404, "Файл недоступен")
    return FileResponse(path, media_type=media.mime_type, headers={"Cache-Control": "private, max-age=300", "X-Robots-Tag": "noindex"})


@app.get("/api/admin/media")
def admin_media(q: str = "", kind: str = "", user: User = Depends(admin_user), db: Session = Depends(get_db)):
    query = select(Media)
    if q:
        query = query.where(Media.original_name.ilike(f"%{q[:100]}%"))
    if kind in {"image", "video"}:
        query = query.where(Media.media_type == kind)
    rows = db.scalars(query.order_by(Media.created_at.desc()).limit(300)).all()
    site_values = settings_dict(db)
    return [{"id": str(m.id), "url": f"/api/media/{m.id}", "media_type": m.media_type,
             "original_name": m.original_name, "size_bytes": m.size_bytes, "created_at": m.created_at,
             "usage_count": (db.scalar(select(func.count()).select_from(PostMedia).where(PostMedia.media_id == m.id)) or 0)
                            + (db.scalar(select(func.count()).select_from(Profile).where(Profile.avatar_media_id == m.id)) or 0)
                            + sum(site_values.get(key) == str(m.id) for key in ("logo_media_id", "favicon_media_id", "background_media_id"))} for m in rows]


@app.delete("/api/admin/media/{media_id}", dependencies=[Depends(csrf_protect)])
async def delete_media(media_id: UUID, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    media = db.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Файл не найден")
    site_values = settings_dict(db)
    if (db.scalar(select(PostMedia.id).where(PostMedia.media_id == media_id)) or
        db.scalar(select(Profile.id).where(Profile.avatar_media_id == media_id)) or
        str(media_id) in {site_values.get("logo_media_id"), site_values.get("favicon_media_id"), site_values.get("background_media_id")}):
        raise HTTPException(409, "Файл используется в публикации, профиле или настройках сайта")
    key = media.storage_key
    db.delete(media)
    audit(db, user, "delete", "media", media.id)
    db.commit()
    if os.getenv("BLOB_READ_WRITE_TOKEN"):
        from vercel.blob import delete_blob
        await delete_blob(key)
    else:
        (Path(settings.upload_dir).resolve() / key).unlink(missing_ok=True)
    return {"ok": True}


@app.get("/api/admin/stats")
def admin_stats(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    publish_due(db)
    def count(model, *filters):
        return db.scalar(select(func.count()).select_from(model).where(*filters)) or 0
    recent_logs = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(8)).all()
    recent_comments = db.scalars(select(Comment).order_by(Comment.created_at.desc()).limit(8)).all()
    return {
        "posts": count(Post, Post.deleted_at.is_(None)), "photos": count(Media, Media.media_type == "image"),
        "videos": count(Media, Media.media_type == "video"), "comments": count(Comment, Comment.deleted_at.is_(None)),
        "reactions": count(PostLike) + count(CommentLike), "drafts": count(Post, Post.status == "draft"),
        "scheduled": count(Post, Post.status == "scheduled"),
        "recent_actions": [{"action": x.action, "entity_type": x.entity_type, "entity_id": x.entity_id,
                            "created_at": x.created_at} for x in recent_logs],
        "recent_comments": [comment_dict(db, x, user) for x in recent_comments],
    }


@app.get("/api/admin/posts")
def admin_posts(q: str = "", status: str = "", author_id: UUID | None = None, category_id: UUID | None = None,
                event_date_from: date | None = None, event_date_to: date | None = None, sort: str = "new",
                limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                user: User = Depends(admin_user), db: Session = Depends(get_db)):
    query = select(Post).where(Post.deleted_at.is_not(None) if status == "deleted" else Post.deleted_at.is_(None))
    if q:
        query = query.where(or_(Post.title.ilike(f"%{q[:100]}%"), Post.content.ilike(f"%{q[:100]}%")))
    if status and status != "deleted":
        query = query.where(Post.status == status)
    if author_id:
        query = query.where(Post.author_profile_id == author_id)
    if category_id:
        from app.models import PostCategory
        query = query.join(PostCategory).where(PostCategory.category_id == category_id)
    if event_date_from:
        query = query.where(Post.event_date >= event_date_from)
    if event_date_to:
        query = query.where(Post.event_date <= event_date_to)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    order = {"new": Post.created_at.desc(), "old": Post.created_at.asc(),
             "event_new": Post.event_date.desc().nullslast(), "event_old": Post.event_date.asc().nullslast()}.get(sort, Post.created_at.desc())
    rows = db.scalars(query.order_by(order).offset(offset).limit(limit)).all()
    return {"items": [post_dict(db, p, user) for p in rows], "total": total}


@app.get("/api/admin/profiles")
def admin_profiles(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [profile_dict(p) for p in db.scalars(select(Profile).order_by(Profile.created_at)).all()]


@app.post("/api/admin/profiles", status_code=201, dependencies=[Depends(csrf_protect)])
def create_profile(payload: ProfileIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if payload.avatar_media_id and not db.get(Media, payload.avatar_media_id):
        raise HTTPException(422, "Аватар не найден")
    profile = Profile(**payload.model_dump())
    db.add(profile)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Username уже занят")
    audit(db, user, "create", "profile", profile.id)
    db.commit()
    return profile_dict(profile)


@app.patch("/api/admin/profiles/{profile_id}", dependencies=[Depends(csrf_protect)])
def update_profile(profile_id: UUID, payload: ProfilePatch, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    profile = db.get(Profile, profile_id)
    if not profile:
        raise HTTPException(404, "Профиль не найден")
    if payload.avatar_media_id and not db.get(Media, payload.avatar_media_id):
        raise HTTPException(422, "Аватар не найден")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Username уже занят")
    audit(db, user, "update", "profile", profile.id)
    db.commit()
    return profile_dict(profile)


@app.get("/api/admin/comments")
def admin_comments(status: str = "", q: str = "", post_id: UUID | None = None,
                   user: User = Depends(admin_user), db: Session = Depends(get_db)):
    query = select(Comment).where(Comment.deleted_at.is_(None))
    if status:
        query = query.where(Comment.moderation_status == status)
    if q:
        query = query.where(Comment.content.ilike(f"%{q[:100]}%"))
    if post_id:
        query = query.where(Comment.post_id == post_id)
    return [comment_dict(db, c, user) for c in db.scalars(query.order_by(Comment.created_at.desc()).limit(300)).all()]


@app.patch("/api/admin/comments/{comment_id}/moderate", dependencies=[Depends(csrf_protect)])
def moderate_comment(comment_id: UUID, action: str, reason: str = "", user: User = Depends(admin_user), db: Session = Depends(get_db)):
    comment = db.get(Comment, comment_id)
    if not comment:
        raise HTTPException(404, "Комментарий не найден")
    if action not in {"approve", "hide", "spam"}:
        raise HTTPException(422, "Недопустимое действие")
    comment.moderation_status = {"approve": "approved", "hide": "hidden", "spam": "spam"}[action]
    db.add(ModerationHistory(comment_id=comment_id, actor_user_id=user.id, action=action, reason=reason[:500]))
    audit(db, user, action, "comment", comment.id)
    db.commit()
    return comment_dict(db, comment, user)


@app.get("/api/admin/settings")
def admin_settings(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    return settings_dict(db)


@app.patch("/api/admin/settings", dependencies=[Depends(csrf_protect)])
def update_settings(payload: dict, user: User = Depends(super_admin_user), db: Session = Depends(get_db)):
    for key, value in payload.items():
        if key not in DEFAULT_SETTINGS:
            raise HTTPException(422, f"Неизвестная настройка: {key}")
        if key in {"site_public", "registration_enabled"} and not isinstance(value, bool):
            raise HTTPException(422, f"{key} должно быть логическим значением")
        if key == "theme" and value not in {"light", "dark", "romantic"}:
            raise HTTPException(422, "Недопустимая тема")
        if key not in {"site_public", "registration_enabled", "theme"} and value is not None and not isinstance(value, str):
            raise HTTPException(422, f"{key} должно быть строкой")
        if key in {"logo_media_id", "favicon_media_id", "background_media_id"} and value:
            try:
                referenced_media = db.get(Media, UUID(value))
            except ValueError:
                referenced_media = None
            if not referenced_media or referenced_media.media_type != "image":
                raise HTTPException(422, "Выберите загруженное изображение")
        row = db.get(SiteSetting, key)
        if row:
            row.value = value
        else:
            db.add(SiteSetting(key=key, value=value))
    audit(db, user, "update", "settings", "site")
    db.commit()
    return settings_dict(db)


@app.post("/api/admin/categories", status_code=201, dependencies=[Depends(csrf_protect)])
def create_category(payload: CategoryIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    category = Category(**payload.model_dump())
    db.add(category)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Такая категория уже существует")
    audit(db, user, "create", "category", category.id)
    db.commit()
    return {"id": str(category.id), "name": category.name, "slug": category.slug}


@app.patch("/api/admin/categories/{category_id}", dependencies=[Depends(csrf_protect)])
def update_category(category_id: UUID, payload: CategoryIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "Категория не найдена")
    category.name = payload.name
    category.slug = payload.slug
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Такой адрес категории уже существует")
    audit(db, user, "update", "category", category.id)
    db.commit()
    return {"id": str(category.id), "name": category.name, "slug": category.slug}


@app.delete("/api/admin/categories/{category_id}", dependencies=[Depends(csrf_protect)])
def delete_category(category_id: UUID, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    category = db.get(Category, category_id)
    if not category:
        raise HTTPException(404, "Категория не найдена")
    db.delete(category)
    audit(db, user, "delete", "category", category.id)
    db.commit()
    return {"ok": True}


@app.get("/api/admin/users")
def admin_users(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [{"id": str(x.id), "email": x.email, "display_name": x.display_name, "role": x.role,
             "is_active": x.is_active, "access_granted": x.access_granted, "created_at": x.created_at} for x in db.scalars(select(User).order_by(User.created_at)).all()]


@app.patch("/api/admin/users/{user_id}", dependencies=[Depends(csrf_protect)])
def update_user(user_id: UUID, payload: UserPatch, actor: User = Depends(super_admin_user), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    if target.role == "super_admin" or target.id == actor.id:
        raise HTTPException(403, "Главного администратора нельзя изменить здесь")
    if payload.role is not None and payload.role not in {"admin", "member"}:
        raise HTTPException(422, "Недопустимая роль")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(target, key, value)
    audit(db, actor, "update", "user", user_id)
    db.commit()
    return {"id": str(target.id), "email": target.email, "display_name": target.display_name,
            "role": target.role, "is_active": target.is_active, "access_granted": target.access_granted}


@app.post("/api/admin/invitations", status_code=201, dependencies=[Depends(csrf_protect)])
def create_invitation(payload: InvitationIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if payload.role not in {"member", "admin"}:
        raise HTTPException(422, "Недопустимая роль")
    if payload.role == "admin" and user.role != "super_admin":
        raise HTTPException(403, "Приглашать администраторов может только главный администратор")
    existing = db.scalar(select(User).where(User.email == payload.email.lower()))
    if existing and existing.role == "super_admin":
        raise HTTPException(403, "Восстановление главного администратора через приглашение недоступно")
    if existing and existing.role == "admin" and user.role != "super_admin":
        raise HTTPException(403, "Восстановить администратора может только главный администратор")
    raw = secrets.token_urlsafe(40)
    invitation = Invitation(email=payload.email.lower(), role=payload.role, token_hash=token_hash(raw),
                            invited_by_user_id=user.id, expires_at=now() + timedelta(days=7))
    db.add(invitation)
    db.flush()
    audit(db, user, "invite", "user", invitation.id)
    db.commit()
    return {"token": raw, "email": invitation.email, "expires_at": invitation.expires_at,
            "invite_url": f"{settings.frontend_origin}/invite?token={raw}"}


@app.post("/api/auth/accept-invitation")
def accept_invitation(payload: AcceptInvitationIn, response: Response, db: Session = Depends(get_db)):
    invitation = db.scalar(select(Invitation).where(Invitation.token_hash == token_hash(payload.token)))
    if not invitation or invitation.used_at or as_utc(invitation.expires_at) < now():
        raise HTTPException(400, "Приглашение недействительно или истекло")
    user = db.scalar(select(User).where(User.email == invitation.email))
    if user and user.role == "super_admin":
        raise HTTPException(403, "Восстановление главного администратора через приглашение недоступно")
    if invitation.role == "admin" or (user and user.role == "admin"):
        inviter = db.get(User, invitation.invited_by_user_id)
        if not inviter or not inviter.is_active or not inviter.access_granted or inviter.role != "super_admin":
            raise HTTPException(403, "Приглашение администратора больше недействительно")
    if user:
        user.password_hash = hash_password(payload.password)
        user.display_name = payload.display_name
        user.is_active = True
        user.access_granted = True
        if invitation.role == "admin" and user.role == "member":
            user.role = "admin"
        db.query(SessionToken).filter(SessionToken.user_id == user.id).update({"revoked_at": now()})
    else:
        user = User(email=invitation.email, password_hash=hash_password(payload.password),
                    display_name=payload.display_name, role=invitation.role, access_granted=True)
        db.add(user)
        db.flush()
    invitation.used_at = now()
    audit(db, user, "accept_invitation", "user", user.id)
    db.commit()
    issue_session(db, user, response)
    return {"id": str(user.id), "email": user.email, "display_name": user.display_name, "role": user.role, "access_granted": user.access_granted}


@app.post("/api/auth/register", status_code=201)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)):
    # Open registration is intentionally a separate administrator-controlled setting.
    if not settings_dict(db)["registration_enabled"]:
        raise HTTPException(403, "Регистрация закрыта")
    email = payload.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "Этот email уже используется")
    user = User(email=email, password_hash=hash_password(payload.password), display_name=payload.display_name, role="member", access_granted=False)
    db.add(user)
    db.commit()
    issue_session(db, user, response)
    return {"id": str(user.id), "email": user.email, "display_name": user.display_name, "role": user.role, "access_granted": user.access_granted}
