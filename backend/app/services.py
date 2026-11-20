from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (Bookmark, Category, Comment, CommentLike, Media, Mention, Post, PostCategory, PostCoauthor,
                        PostCommentPermission, PostLike, PostMedia, PostTag, Profile, SiteSetting, Tag, User)
from app.schemas import PostIn, PostPatch


DEFAULT_SETTINGS = {
    "site_title": "Our Memories",
    "site_description": "История, которую мы пишем вместе",
    "relationship_start": None,
    "primary_name": "Нурасыл",
    "secondary_name": "Аяжан",
    "site_public": False,
    "registration_enabled": False,
    "theme": "light",
    "hero_text": "Каждый момент — часть нашей истории.",
    "logo_media_id": None,
    "favicon_media_id": None,
    "background_media_id": None,
}


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def settings_dict(db: Session) -> dict:
    values = dict(DEFAULT_SETTINGS)
    values.update({item.key: item.value for item in db.scalars(select(SiteSetting)).all()})
    return values


def is_admin(user: User | None) -> bool:
    return bool(user and user.access_granted and user.role in {"admin", "super_admin"})


def publish_due(db: Session) -> None:
    due = db.scalars(select(Post).where(Post.status == "scheduled", Post.scheduled_at <= datetime.now(timezone.utc), Post.deleted_at.is_(None))).all()
    if due:
        for post in due:
            post.status = "published"
            post.published_at = post.scheduled_at
        db.commit()


def can_see_post(db: Session, post: Post, user: User | None) -> bool:
    if post.deleted_at is not None:
        return False
    if is_admin(user):
        return True
    if post.status != "published" or (post.published_at and as_utc(post.published_at) > datetime.now(timezone.utc)):
        return False
    if post.visibility == "public":
        return bool((user and user.access_granted) or settings_dict(db)["site_public"])
    if post.visibility == "invited":
        return bool(user and user.access_granted)
    return False


def require_post(db: Session, post_id: UUID, user: User | None) -> Post:
    post = db.get(Post, post_id)
    if not post or not can_see_post(db, post, user):
        raise HTTPException(404, "Публикация не найдена")
    return post


def profile_dict(profile: Profile | None) -> dict | None:
    if profile is None:
        return None
    return {
        "id": str(profile.id), "display_name": profile.display_name, "username": profile.username,
        "avatar_url": f"/api/media/{profile.avatar_media_id}" if profile.avatar_media_id else None,
        "bio": profile.bio, "age": profile.age,
        "instagram_url": profile.instagram_url, "tiktok_url": profile.tiktok_url,
        "is_active": profile.is_active,
    }


def media_dict(db: Session, link: PostMedia) -> dict:
    media = db.get(Media, link.media_id)
    return {
        "id": str(media.id), "url": f"/api/media/{media.id}", "media_type": media.media_type,
        "mime_type": media.mime_type, "alt_text": link.alt_text,
        "sort_order": link.sort_order, "is_cover": link.is_cover,
        "width": media.width, "height": media.height,
    }


def post_dict(db: Session, post: Post, user: User | None) -> dict:
    links = db.scalars(select(PostMedia).where(PostMedia.post_id == post.id).order_by(PostMedia.sort_order)).all()
    tags = db.scalars(select(Tag).join(PostTag, Tag.id == PostTag.tag_id).where(PostTag.post_id == post.id)).all()
    mentions = db.scalars(select(Mention.profile_id).where(Mention.post_id == post.id)).all()
    categories = db.scalars(select(Category).join(PostCategory, Category.id == PostCategory.category_id).where(PostCategory.post_id == post.id)).all()
    likes = db.scalar(select(func.count()).select_from(PostLike).where(PostLike.post_id == post.id)) or 0
    comments = db.scalar(select(func.count()).select_from(Comment).where(Comment.post_id == post.id, Comment.deleted_at.is_(None), Comment.moderation_status == "approved")) or 0
    liked = bool(user and db.scalar(select(PostLike.id).where(PostLike.post_id == post.id, PostLike.user_id == user.id)))
    bookmarked = bool(user and db.scalar(select(Bookmark.id).where(Bookmark.post_id == post.id, Bookmark.user_id == user.id)))
    coauthor_id = db.scalar(select(PostCoauthor.profile_id).where(PostCoauthor.post_id == post.id))
    return {
        "id": str(post.id), "author": profile_dict(db.get(Profile, post.author_profile_id)),
        "coauthor": profile_dict(db.get(Profile, coauthor_id)) if coauthor_id else None,
        "title": post.title, "content": post.content, "event_date": post.event_date, "event_time": post.event_time,
        "location": post.location, "visibility": post.visibility, "status": post.status,
        "comments_enabled": post.comments_enabled, "comment_access": post.comment_access,
        "moderate_comments": post.moderate_comments, "reactions_enabled": post.reactions_enabled,
        "hide_like_count": post.hide_like_count, "quote_enabled": post.quote_enabled,
        "show_in_timeline": post.show_in_timeline, "is_pinned": post.is_pinned,
        "scheduled_at": post.scheduled_at, "published_at": post.published_at,
        "created_at": post.created_at, "updated_at": post.updated_at, "deleted_at": post.deleted_at,
        "media": [media_dict(db, link) for link in links], "categories": [{"id": str(c.id), "name": c.name, "slug": c.slug} for c in categories],
        "tags": [t.name for t in tags], "likes_count": None if post.hide_like_count and not is_admin(user) else likes,
        "mention_profile_ids": [str(profile_id) for profile_id in mentions],
        "mentions": [profile_dict(db.get(Profile, profile_id)) for profile_id in mentions],
        "comments_count": comments, "liked": liked, "bookmarked": bookmarked,
        "allowed_comment_user_ids": [str(x) for x in db.scalars(select(PostCommentPermission.user_id).where(PostCommentPermission.post_id == post.id)).all()] if is_admin(user) else [],
    }


def comment_dict(db: Session, comment: Comment, user: User | None) -> dict:
    author = db.get(User, comment.user_id)
    author_profile = db.scalar(select(Profile).where(Profile.linked_user_id == comment.user_id).order_by(Profile.created_at))
    likes = db.scalar(select(func.count()).select_from(CommentLike).where(CommentLike.comment_id == comment.id)) or 0
    replies = db.scalar(select(func.count()).select_from(Comment).where(Comment.parent_id == comment.id, Comment.deleted_at.is_(None), Comment.moderation_status == "approved")) or 0
    return {
        "id": str(comment.id), "post_id": str(comment.post_id), "parent_id": str(comment.parent_id) if comment.parent_id else None,
        "user_id": str(comment.user_id), "author_name": author.display_name if author else "Участник",
        "author_avatar_url": f"/api/media/{author_profile.avatar_media_id}" if author_profile and author_profile.avatar_media_id else None,
        "content": comment.content, "moderation_status": comment.moderation_status,
        "created_at": comment.created_at, "updated_at": comment.updated_at,
        "likes_count": likes, "replies_count": replies,
        "liked": bool(user and db.scalar(select(CommentLike.id).where(CommentLike.comment_id == comment.id, CommentLike.user_id == user.id))),
        "can_edit": bool(user and (user.id == comment.user_id or is_admin(user))),
    }


def apply_post_data(db: Session, post: Post, data: PostIn | PostPatch) -> None:
    values = data.model_dump(exclude_unset=True)
    for key in ("media", "tags", "category_ids", "mention_profile_ids", "allowed_comment_user_ids", "coauthor_profile_id"):
        values.pop(key, None)
    for key, value in values.items():
        if key == "author_profile_id" and value is None:
            continue
        setattr(post, key, value)
    if not post.content.strip() and not (data.media if "media" in data.model_fields_set else db.scalar(select(PostMedia.id).where(PostMedia.post_id == post.id))):
        raise HTTPException(422, "Добавьте текст или медиафайл")
    if post.event_time and not post.event_date:
        raise HTTPException(422, "Для времени события укажите дату")
    if post.status == "scheduled" and not post.scheduled_at:
        raise HTTPException(422, "Укажите дату запланированной публикации")
    if post.status == "published" and not post.published_at:
        post.published_at = datetime.now(timezone.utc)
    if data.author_profile_id is not None and not db.get(Profile, data.author_profile_id):
        raise HTTPException(422, "Профиль автора не найден")
    db.flush()
    if "coauthor_profile_id" in data.model_fields_set:
        db.query(PostCoauthor).filter(PostCoauthor.post_id == post.id).delete()
        if data.coauthor_profile_id:
            if not db.get(Profile, data.coauthor_profile_id):
                raise HTTPException(422, "Соавтор не найден")
            if data.coauthor_profile_id == post.author_profile_id:
                raise HTTPException(422, "Соавтор должен отличаться от автора")
            db.add(PostCoauthor(post_id=post.id, profile_id=data.coauthor_profile_id))
    if "media" in data.model_fields_set:
        if len(data.media) > 20:
            raise HTTPException(422, "Не больше 20 файлов в одной публикации")
        if len({item.media_id for item in data.media}) != len(data.media):
            raise HTTPException(422, "Один файл нельзя добавить дважды")
        if sum(item.is_cover for item in data.media) > 1:
            raise HTTPException(422, "Выберите одну обложку")
        db.query(PostMedia).filter(PostMedia.post_id == post.id).delete()
        for item in data.media:
            if not db.get(Media, item.media_id):
                raise HTTPException(422, "Медиафайл не найден")
            db.add(PostMedia(post_id=post.id, **item.model_dump()))
    if "category_ids" in data.model_fields_set:
        db.query(PostCategory).filter(PostCategory.post_id == post.id).delete()
        for cid in set(data.category_ids):
            if not db.get(Category, cid):
                raise HTTPException(422, "Категория не найдена")
            db.add(PostCategory(post_id=post.id, category_id=cid))
    if "tags" in data.model_fields_set:
        db.query(PostTag).filter(PostTag.post_id == post.id).delete()
        for name in set(x.strip().lower()[:80] for x in data.tags if x.strip()):
            tag = db.scalar(select(Tag).where(Tag.name == name))
            if not tag:
                tag = Tag(name=name)
                db.add(tag)
                db.flush()
            db.add(PostTag(post_id=post.id, tag_id=tag.id))
    if "mention_profile_ids" in data.model_fields_set:
        db.query(Mention).filter(Mention.post_id == post.id).delete()
        for pid in set(data.mention_profile_ids):
            if not db.get(Profile, pid):
                raise HTTPException(422, "Отмеченный профиль не найден")
            db.add(Mention(post_id=post.id, profile_id=pid))
    if "allowed_comment_user_ids" in data.model_fields_set:
        db.query(PostCommentPermission).filter(PostCommentPermission.post_id == post.id).delete()
        for uid in set(data.allowed_comment_user_ids):
            if not db.get(User, uid):
                raise HTTPException(422, "Участник не найден")
            db.add(PostCommentPermission(post_id=post.id, user_id=uid))
