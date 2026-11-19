import argparse
import getpass

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Profile, SessionToken, User, now
from app.security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="Our Memories management")
    parser.add_argument("command", choices=["create-admin", "reset-admin-password", "seed-profiles"])
    parser.add_argument("--email")
    parser.add_argument("--name")
    args = parser.parse_args()
    with SessionLocal() as db:
        if args.command == "create-admin":
            email = (args.email or input("Email: ")).strip().lower()
            name = (args.name or input("Имя: ")).strip()
            password = getpass.getpass("Пароль (минимум 12 символов): ")
            if len(password) < 12:
                raise SystemExit("Пароль должен содержать минимум 12 символов")
            if db.scalar(select(User.id).where(User.email == email)):
                raise SystemExit("Пользователь с таким email уже существует")
            db.add(User(email=email, display_name=name, password_hash=hash_password(password), role="super_admin", access_granted=True))
            db.commit()
            print("Главный администратор создан")
        elif args.command == "reset-admin-password":
            email = (args.email or input("Email главного администратора: ")).strip().lower()
            user = db.scalar(select(User).where(User.email == email, User.role == "super_admin"))
            if not user:
                raise SystemExit("Главный администратор с таким email не найден")
            password = getpass.getpass("Новый пароль (минимум 12 символов): ")
            confirmation = getpass.getpass("Повторите пароль: ")
            if len(password) < 12 or password != confirmation:
                raise SystemExit("Пароли должны совпадать и содержать минимум 12 символов")
            user.password_hash = hash_password(password)
            db.query(SessionToken).filter(SessionToken.user_id == user.id).update({"revoked_at": now()})
            db.commit()
            print("Пароль обновлён. Все прежние сессии завершены")
        else:
            for display_name, username in (("Нурасыл", "nurasyl"), ("Аяжан", "ayazhan")):
                if not db.scalar(select(Profile.id).where(Profile.username == username)):
                    db.add(Profile(display_name=display_name, username=username))
            db.commit()
            print("Профили созданы. Имена можно изменить в админке.")


if __name__ == "__main__":
    main()
