from __future__ import annotations

from datetime import date, datetime, time
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, ValidationInfo, field_validator


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileSocialFields(BaseModel):
    age: int | None = Field(default=None, ge=1, le=120)
    instagram_url: str | None = Field(default=None, max_length=300)
    tiktok_url: str | None = Field(default=None, max_length=300)

    @field_validator("instagram_url", "tiktok_url")
    @classmethod
    def valid_social_link(cls, value: str | None, info: ValidationInfo) -> str | None:
        if not value:
            return None
        parsed = urlparse(value.strip())
        hosts = {"instagram_url": {"instagram.com", "www.instagram.com"},
                 "tiktok_url": {"tiktok.com", "www.tiktok.com"}}
        if (parsed.scheme != "https" or parsed.hostname not in hosts[info.field_name]
                or parsed.username or parsed.password or not parsed.path.strip("/")):
            raise ValueError("Укажите полную HTTPS-ссылку на профиль нужной соцсети")
        return value.strip()


class ProfileIn(ProfileSocialFields):
    display_name: str = Field(min_length=1, max_length=100)
    username: str = Field(min_length=2, max_length=50, pattern=r"^[a-zA-Z0-9_.]+$")
    bio: str = Field(default="", max_length=1000)
    avatar_media_id: UUID | None = None
    linked_user_id: UUID | None = None
    is_active: bool = True


class ProfilePatch(ProfileSocialFields):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    username: str | None = Field(default=None, min_length=2, max_length=50, pattern=r"^[a-zA-Z0-9_.]+$")
    bio: str | None = Field(default=None, max_length=1000)
    avatar_media_id: UUID | None = None
    linked_user_id: UUID | None = None
    is_active: bool | None = None


class OwnProfilePatch(ProfileSocialFields):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    bio: str | None = Field(default=None, max_length=1000)
    avatar_media_id: UUID | None = None

    @field_validator("display_name")
    @classmethod
    def nonempty_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Имя не может быть пустым")
        return value.strip() if value is not None else None


class MediaRef(BaseModel):
    media_id: UUID
    alt_text: str = Field(default="", max_length=500)
    sort_order: int = Field(default=0, ge=0)
    is_cover: bool = False


class PostIn(BaseModel):
    author_profile_id: UUID
    coauthor_profile_id: UUID | None = None
    title: str | None = Field(default=None, max_length=200)
    content: str = Field(default="", max_length=20000)
    event_date: date | None = None
    event_time: time | None = None
    location: str | None = Field(default=None, max_length=200)
    visibility: str = "private"
    status: str = "draft"
    comments_enabled: bool = True
    comment_access: str = "members"
    allowed_comment_user_ids: list[UUID] = Field(default_factory=list)
    moderate_comments: bool = False
    reactions_enabled: bool = True
    hide_like_count: bool = False
    quote_enabled: bool = True
    show_in_timeline: bool = True
    is_pinned: bool = False
    scheduled_at: datetime | None = None
    published_at: datetime | None = None
    category_ids: list[UUID] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    mention_profile_ids: list[UUID] = Field(default_factory=list)
    media: list[MediaRef] = Field(default_factory=list)

    @field_validator("visibility")
    @classmethod
    def validate_visibility(cls, value: str) -> str:
        if value not in {"public", "private", "invited"}:
            raise ValueError("Недопустимая видимость")
        return value

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        if value not in {"draft", "scheduled", "published", "archived"}:
            raise ValueError("Недопустимый статус")
        return value

    @field_validator("comment_access")
    @classmethod
    def validate_comment_access(cls, value: str) -> str:
        if value not in {"members", "selected"}:
            raise ValueError("Недопустимый доступ к комментариям")
        return value


class PostPatch(PostIn):
    author_profile_id: UUID | None = None


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=3000)
    parent_id: UUID | None = None


class CommentPatch(BaseModel):
    content: str = Field(min_length=1, max_length=3000)


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")


class InvitationIn(BaseModel):
    email: EmailStr
    role: str = "member"


class AcceptInvitationIn(BaseModel):
    token: str
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=200)


class RegisterIn(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=12, max_length=200)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12, max_length=200)


class UserPatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    role: str | None = None
    is_active: bool | None = None
    access_granted: bool | None = None
