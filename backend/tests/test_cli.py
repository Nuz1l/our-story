import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import cli
from app.db import Base
from app.models import SessionToken, User
from app.security import hash_password, verify_password


def test_super_admin_password_reset_revokes_existing_sessions(monkeypatch):
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(email="owner@example.com", display_name="Владелец", role="super_admin", access_granted=True,
                    password_hash=hash_password("previous-password"))
        db.add(user)
        db.flush()
        session = SessionToken(user_id=user.id, token_hash="old-refresh-token",
                               expires_at=datetime.now(timezone.utc) + timedelta(days=7))
        db.add(session)
        db.commit()
        user_id, session_id = user.id, session.id

    monkeypatch.setattr(cli, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(sys, "argv", ["cli", "reset-admin-password", "--email", "owner@example.com"])
    passwords = iter(["new-secure-password", "new-secure-password"])
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: next(passwords))
    cli.main()

    with Session(engine) as db:
        assert verify_password("new-secure-password", db.get(User, user_id).password_hash)
        assert db.get(SessionToken, session_id).revoked_at is not None
    engine.dispose()
