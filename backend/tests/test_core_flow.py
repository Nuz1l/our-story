from io import BytesIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from PIL import Image
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app, settings
from app.models import Profile, User
from app.security import hash_password


@pytest.fixture
def environment(tmp_path):
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    settings.upload_dir = str(tmp_path / "uploads")
    with Session(engine) as db:
        admin = User(id=uuid4(), email="admin@example.com", display_name="Админ", password_hash=hash_password("very-secure-password"), role="super_admin", access_granted=True)
        profile = Profile(id=uuid4(), display_name="Нурасыл", username="nurasyl")
        db.add_all([admin, profile])
        db.commit()
        profile_id = str(profile.id)

    def override_db():
        with Session(engine, autoflush=False, expire_on_commit=False) as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    yield profile_id
    app.dependency_overrides.clear()
    engine.dispose()


def csrf(client: TestClient) -> dict:
    return {"X-CSRF-Token": client.cookies.get("csrf_token")}


def test_private_post_invitation_comments_and_reactions(environment):
    profile_id = environment
    guest = TestClient(app)
    admin = TestClient(app)
    assert guest.get("/api/posts").json()["items"] == []
    assert admin.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"}).status_code == 200
    created = admin.post("/api/posts", headers=csrf(admin), json={
        "author_profile_id": profile_id, "title": "Первый день", "content": "Мы встретились",
        "status": "published", "visibility": "invited", "event_date": "2026-01-01",
    })
    assert created.status_code == 201, created.text
    post_id = created.json()["id"]
    assert guest.get(f"/api/posts/{post_id}").status_code == 404
    assert admin.post(f"/api/posts/{post_id}/like").status_code == 403  # CSRF is required.

    invited = admin.post("/api/admin/invitations", headers=csrf(admin), json={"email": "member@example.com", "role": "member"})
    assert invited.status_code == 201, invited.text
    member = TestClient(app)
    accepted = member.post("/api/auth/accept-invitation", json={"token": invited.json()["token"], "display_name": "Друг", "password": "another-secure-password"})
    assert accepted.status_code == 200, accepted.text
    assert member.get("/api/posts").json()["total"] == 1
    private_post = admin.post("/api/posts", headers=csrf(admin), json={"author_profile_id": profile_id, "content": "Только для администраторов", "status": "published", "visibility": "private"})
    assert private_post.status_code == 201
    assert member.get(f"/api/posts/{private_post.json()['id']}").status_code == 404
    root = member.post(f"/api/posts/{post_id}/comments", headers=csrf(member), json={"content": "Какой день!"})
    assert root.status_code == 201, root.text
    reply = member.post(f"/api/comments/{root.json()['id']}/replies", headers=csrf(member), json={"content": "Да!"})
    assert reply.status_code == 201, reply.text
    assert member.get(f"/api/posts/{post_id}/comments", params={"parent_id": root.json()["id"]}).json()["total"] == 1
    assert member.post(f"/api/posts/{post_id}/like", headers=csrf(member)).status_code == 200
    assert member.post(f"/api/posts/{post_id}/like", headers=csrf(member)).status_code == 200
    assert member.get(f"/api/posts/{post_id}").json()["likes_count"] == 1
    assert member.post(f"/api/posts/{post_id}/bookmark", headers=csrf(member)).status_code == 200
    assert len(member.get("/api/bookmarks").json()) == 1
    assert member.delete(f"/api/posts/{post_id}/like", headers=csrf(member)).status_code == 200
    assert member.get(f"/api/posts/{post_id}").json()["likes_count"] == 0
    assert admin.delete(f"/api/posts/{post_id}", headers=csrf(admin)).status_code == 200
    assert admin.get("/api/admin/posts", params={"status": "deleted"}).json()["total"] == 1
    assert member.get(f"/api/posts/{post_id}").status_code == 404
    assert admin.post(f"/api/posts/{post_id}/restore", headers=csrf(admin)).status_code == 200
    assert member.get(f"/api/posts/{post_id}").status_code == 200


def test_public_visibility_requires_site_setting(environment):
    admin = TestClient(app)
    guest = TestClient(app)
    admin.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"})
    created = admin.post("/api/posts", headers=csrf(admin), json={"author_profile_id": environment, "content": "Привет", "status": "published", "visibility": "public"})
    assert created.status_code == 201, created.text
    assert guest.get("/api/posts").json()["total"] == 0
    assert admin.patch("/api/admin/settings", headers=csrf(admin), json={"site_public": True}).status_code == 200
    assert guest.get("/api/posts").json()["total"] == 1


def test_user_can_edit_own_profile_and_avatar(environment):
    client = TestClient(app)
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"}).status_code == 200
    initial = client.get("/api/profile/me")
    assert initial.status_code == 200
    assert initial.json()["id"] is None
    invalid = client.patch("/api/profile/me", headers=csrf(client), json={"instagram_url": "https://example.com/not-instagram"})
    assert invalid.status_code == 422
    saved = client.patch("/api/profile/me", headers=csrf(client), json={
        "display_name": "Новое имя", "age": 25, "bio": "О себе",
        "instagram_url": "https://www.instagram.com/example/",
        "tiktok_url": "https://www.tiktok.com/@example",
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["age"] == 25
    assert saved.json()["instagram_url"] == "https://www.instagram.com/example/"
    assert client.get("/api/auth/me").json()["display_name"] == "Новое имя"
    image = BytesIO()
    Image.new("RGB", (20, 20), "#aabbcc").save(image, format="PNG")
    avatar = client.post("/api/profile/avatar", headers=csrf(client), files={"file": ("avatar.png", image.getvalue(), "image/png")})
    assert avatar.status_code == 200, avatar.text
    assert avatar.json()["avatar_url"].startswith("/api/media/")
    assert client.get(avatar.json()["avatar_url"]).status_code == 200


def test_avatar_follows_existing_author_posts_and_comments(environment):
    client = TestClient(app)
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"}).status_code == 200
    name = client.get("/api/auth/me").json()["display_name"]
    author = client.post("/api/admin/profiles", headers=csrf(client), json={
        "display_name": name, "username": "admin_author",
    })
    assert author.status_code == 201, author.text
    post = client.post("/api/posts", headers=csrf(client), json={
        "author_profile_id": author.json()["id"], "content": "Фото автора",
        "status": "published", "visibility": "private",
    })
    assert post.status_code == 201, post.text
    image = BytesIO()
    Image.new("RGB", (20, 20), "#aabbcc").save(image, format="PNG")
    avatar = client.post("/api/profile/avatar", headers=csrf(client), files={"file": ("avatar.png", image.getvalue(), "image/png")})
    assert avatar.status_code == 200, avatar.text
    assert avatar.json()["id"] == author.json()["id"]
    avatar_url = avatar.json()["avatar_url"]
    assert client.get("/api/auth/me").json()["avatar_url"] == avatar_url
    assert client.get(f"/api/posts/{post.json()['id']}").json()["author"]["avatar_url"] == avatar_url
    comment = client.post(f"/api/posts/{post.json()['id']}/comments", headers=csrf(client), json={"content": "Привет"})
    assert comment.status_code == 201, comment.text
    comments = client.get(f"/api/posts/{post.json()['id']}/comments").json()
    assert comments["items"][0]["author_avatar_url"] == avatar_url


def test_video_larger_than_old_limit_uploads_in_chunks(environment):
    client = TestClient(app)
    assert client.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"}).status_code == 200
    content = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * (26 * 1024 * 1024)
    upload_id = str(uuid4())
    chunk_size = 2 * 1024 * 1024
    total = (len(content) + chunk_size - 1) // chunk_size
    for index in range(total):
        chunk = content[index * chunk_size:(index + 1) * chunk_size]
        response = client.post("/api/admin/media/chunk", headers=csrf(client),
                               data={"upload_id": upload_id, "index": index},
                               files={"file": ("part", chunk)})
        assert response.status_code == 200, response.text
    completed = client.post("/api/admin/media/complete", headers=csrf(client), json={
        "upload_id": upload_id, "total": total, "filename": "large.mp4",
    })
    assert completed.status_code == 201, completed.text
    assert completed.json()["size_bytes"] == len(content)
    assert completed.json()["media_type"] == "video"
    assert client.get(completed.json()["url"]).content == content
    abandoned = str(uuid4())
    assert client.post("/api/admin/media/chunk", headers=csrf(client),
                       data={"upload_id": abandoned, "index": 0},
                       files={"file": ("part", b"abc")}).status_code == 200
    cancelled = client.post("/api/admin/media/cancel", headers=csrf(client), json={
        "upload_id": abandoned, "total": 1, "filename": "unused.mp4",
    })
    assert cancelled.status_code == 200
    user_id = client.get("/api/auth/me").json()["id"]
    assert not (Path(settings.upload_dir) / "tmp" / user_id / abandoned / "0").exists()


def test_private_media_and_open_registration_do_not_expose_memories(environment):
    admin = TestClient(app)
    guest = TestClient(app)
    admin.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"})
    image = BytesIO()
    Image.new("RGB", (10, 10), "#d88d85").save(image, format="PNG")
    uploaded = admin.post("/api/admin/media", headers=csrf(admin), files={"file": ("memory.png", image.getvalue(), "image/png")})
    assert uploaded.status_code == 201, uploaded.text
    media_id = uploaded.json()["id"]
    assert guest.get(f"/api/media/{media_id}").status_code == 404
    post = admin.post("/api/posts", headers=csrf(admin), json={"author_profile_id": environment, "content": "Только свои", "status": "published", "visibility": "private", "media": [{"media_id": media_id, "alt_text": "Розовое фото"}]})
    assert post.status_code == 201, post.text
    assert guest.get(f"/api/media/{media_id}").status_code == 404
    assert admin.patch("/api/admin/settings", headers=csrf(admin), json={"registration_enabled": True, "site_public": True}).status_code == 200
    newcomer = TestClient(app)
    registered = newcomer.post("/api/auth/register", json={"email": "new@example.com", "display_name": "Новичок", "password": "new-strong-password"})
    assert registered.status_code == 201, registered.text
    assert registered.json()["access_granted"] is False
    assert newcomer.get("/api/posts").json()["total"] == 0
    assert newcomer.get(f"/api/posts/{post.json()['id']}").status_code == 404
    assert newcomer.get(f"/api/media/{media_id}").status_code == 404


def test_refresh_logout_and_scheduled_publication(environment):
    admin = TestClient(app)
    assert admin.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"}).status_code == 200
    old_refresh = admin.cookies.get("refresh_token")
    assert admin.post("/api/auth/refresh", headers=csrf(admin)).status_code == 200
    assert admin.cookies.get("refresh_token") != old_refresh
    scheduled_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    created = admin.post("/api/posts", headers=csrf(admin), json={"author_profile_id": environment, "content": "По расписанию", "status": "scheduled", "visibility": "invited", "scheduled_at": scheduled_at})
    assert created.status_code == 201, created.text
    assert admin.get("/api/posts").json()["total"] == 1
    assert admin.get(f"/api/posts/{created.json()['id']}").json()["status"] == "published"
    assert admin.post("/api/auth/logout", headers=csrf(admin)).status_code == 200
    assert admin.get("/api/auth/me").status_code == 401


def test_selected_comment_access_and_moderation(environment):
    admin = TestClient(app)
    admin.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"})
    members = []
    for number in (1, 2):
        invite = admin.post("/api/admin/invitations", headers=csrf(admin), json={"email": f"member{number}@example.com", "role": "member"})
        member = TestClient(app)
        accepted = member.post("/api/auth/accept-invitation", json={"token": invite.json()["token"], "display_name": f"Участник {number}", "password": "another-secure-password"})
        members.append((member, accepted.json()["id"]))
    post = admin.post("/api/posts", headers=csrf(admin), json={"author_profile_id": environment, "content": "Разговор", "status": "published", "visibility": "invited", "comment_access": "selected", "allowed_comment_user_ids": [members[0][1]], "moderate_comments": True})
    assert post.status_code == 201, post.text
    post_id = post.json()["id"]
    denied = members[1][0].post(f"/api/posts/{post_id}/comments", headers=csrf(members[1][0]), json={"content": "Нельзя"})
    assert denied.status_code == 403
    pending = members[0][0].post(f"/api/posts/{post_id}/comments", headers=csrf(members[0][0]), json={"content": "На проверке"})
    assert pending.status_code == 201 and pending.json()["moderation_status"] == "pending"
    assert members[1][0].get(f"/api/posts/{post_id}/comments").json()["total"] == 0
    approved = admin.patch(f"/api/admin/comments/{pending.json()['id']}/moderate", headers=csrf(admin), params={"action": "approve"})
    assert approved.status_code == 200
    assert members[1][0].get(f"/api/posts/{post_id}/comments").json()["total"] == 1
    assert members[0][0].get("/api/admin/stats").status_code == 403
    revoked = admin.patch(f"/api/admin/users/{members[0][1]}", headers=csrf(admin), json={"access_granted": False, "role": "admin"})
    assert revoked.status_code == 200
    assert members[0][0].get(f"/api/posts/{post_id}").status_code == 404
    assert members[0][0].get("/api/admin/stats").status_code == 403


def test_invitation_cannot_reset_privileged_accounts_without_super_admin(environment):
    owner = TestClient(app)
    assert owner.post("/api/auth/login", json={"email": "admin@example.com", "password": "very-secure-password"}).status_code == 200
    assert owner.post("/api/admin/invitations", headers=csrf(owner), json={"email": "admin@example.com", "role": "member"}).status_code == 403

    invite = owner.post("/api/admin/invitations", headers=csrf(owner), json={"email": "other-admin@example.com", "role": "admin"})
    assert invite.status_code == 201
    administrator = TestClient(app)
    accepted = administrator.post("/api/auth/accept-invitation", json={"token": invite.json()["token"], "display_name": "Администратор", "password": "another-secure-password"})
    assert accepted.status_code == 200
    assert administrator.post("/api/admin/invitations", headers=csrf(administrator), json={"email": "admin@example.com", "role": "member"}).status_code == 403
    assert administrator.post("/api/admin/invitations", headers=csrf(administrator), json={"email": "other-admin@example.com", "role": "member"}).status_code == 403

    member_invite = owner.post("/api/admin/invitations", headers=csrf(owner), json={"email": "future-admin@example.com", "role": "member"})
    member = TestClient(app)
    created = member.post("/api/auth/accept-invitation", json={"token": member_invite.json()["token"], "display_name": "Участник", "password": "member-secure-password"})
    assert created.status_code == 200
    stale_invite = administrator.post("/api/admin/invitations", headers=csrf(administrator), json={"email": "future-admin@example.com", "role": "member"})
    assert stale_invite.status_code == 201
    promoted = owner.patch(f"/api/admin/users/{created.json()['id']}", headers=csrf(owner), json={"role": "admin"})
    assert promoted.status_code == 200
    assert member.post("/api/auth/accept-invitation", json={"token": stale_invite.json()["token"], "display_name": "Самозванец", "password": "attacker-password"}).status_code == 403

    recovery = owner.post("/api/admin/invitations", headers=csrf(owner), json={"email": "other-admin@example.com", "role": "member"})
    assert recovery.status_code == 201
    assert administrator.post("/api/auth/accept-invitation", json={"token": recovery.json()["token"], "display_name": "Администратор", "password": "new-admin-password"}).status_code == 200
