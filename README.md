# Our Memories

Личный сайт воспоминаний для двух людей. Публикации, фото и видео, вложенные комментарии, реакции, избранное, календарь, галерея и админ-панель работают через FastAPI и PostgreSQL. Интерфейс написан на React, TypeScript, Vite и Tailwind CSS.

По умолчанию сайт закрыт. Даже публикация с пометкой «публичная» не видна гостям, пока главный администратор не включит публичный доступ.

## Повторный запуск на настроенном компьютере

Если проект уже настроен на этом компьютере, из его корневой папки выполните в PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

Сайт откроется на **http://localhost:5173**, админ-панель — на **http://localhost:5173/admin**. Чтобы остановить сайт и локальную базу:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\stop-local.ps1
```

В этой локальной конфигурации база хранится в `%LOCALAPPDATA%\OurMemories\postgres-data` и слушает только `127.0.0.1:55432`. Логи процессов находятся в `logs/`. Запускные скрипты рассчитаны на установленную здесь PostgreSQL 16; для нового компьютера следуйте инструкции ниже.

Если на странице написано «Сервер недоступен», откройте PowerShell в папке проекта:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
Invoke-RestMethod http://localhost:8001/api/health
```

Ожидаемый ответ последней команды — `status: ok`. Затем откройте или обновите `http://localhost:5173`. Скрипт сначала запускает PostgreSQL, затем ждёт готовности FastAPI и только после этого запускает сайт. Если API не ответил, посмотрите последние строки ошибок:

```powershell
Get-Content .\logs\backend.err.log -Tail 40
Get-Content "$env:LOCALAPPDATA\OurMemories\postgres.log" -Tail 40
```

## Что понадобится на Windows 10/11

Установите:

1. [Python 3.12+](https://www.python.org/downloads/windows/) — при установке отметьте **Add python.exe to PATH**.
2. [Node.js LTS](https://nodejs.org/en/download) — установщик Windows включает npm. Для этого проекта подходит Node.js 20.19+ или актуальная LTS.
3. [PostgreSQL](https://www.postgresql.org/download/windows/) — запомните пароль пользователя `postgres`, оставьте порт `5432`, установите **Command Line Tools** и **pgAdmin**.
4. [Git](https://git-scm.com/download/win) — стандартных параметров установки достаточно.
5. [Visual Studio Code](https://code.visualstudio.com/download) — откройте в нём папку проекта. Встроенный терминал: **Terminal → New Terminal**.
6. По желанию: [Docker Desktop](https://www.docker.com/products/docker-desktop/) с включённым WSL 2. С Docker отдельная установка PostgreSQL не нужна.

Проверьте установку в PowerShell:

```powershell
python --version
node --version
npm --version
git --version
```

## Быстрый запуск через Docker Desktop

В корне проекта:

```powershell
Copy-Item .env.example .env
notepad .env
```

В `.env` замените `POSTGRES_PASSWORD` и `JWT_SECRET`. Для секретного ключа можно выполнить `python -c "import secrets; print(secrets.token_urlsafe(48))"` и вставить результат в `JWT_SECRET`. Пароль БД в `DATABASE_URL` для Docker не используется, поскольку Compose собирает адрес из `POSTGRES_USER`, `POSTGRES_PASSWORD` и `POSTGRES_DB`. Для локального запуска без Docker заполните и `DATABASE_URL`.

```powershell
docker compose up --build -d
docker compose exec backend python -m app.cli create-admin
docker compose exec backend python -m app.cli seed-profiles
```

Команда создания администратора спросит email, имя и пароль длиной от 12 символов. Пароль не передаётся аргументом командной строки и не хранится в коде. Откройте **http://localhost:8080**, войдите и перейдите в `/admin`. API доступен на **http://localhost:8000/docs**.

Команды `docker compose logs -f backend` и `docker compose logs -f scheduler` показывают ошибки API и фоновой публикации. `docker compose down` останавливает сервисы, сохраняя базу и медиа в томах Docker.

## Запуск без Docker

### 1. Создайте базу PostgreSQL

Откройте установленный **SQL Shell (psql)** или Query Tool в pgAdmin и подключитесь как `postgres`. В SQL Shell нажимайте Enter для значений по умолчанию, затем введите пароль, заданный при установке. Выполните:

```sql
CREATE ROLE our_memories WITH LOGIN PASSWORD 'замените-на-свой-пароль';
CREATE DATABASE our_memories OWNER our_memories;
```

Если роль или база уже созданы, повторять команды не нужно. В `.env` пароль в `DATABASE_URL` должен совпадать с паролем роли. Если пароль содержит `@`, `:`, `/` или другие специальные символы URL, закодируйте их в адресе либо используйте буквенно-цифровой пароль.

Проверьте, что служба PostgreSQL запущена через **Службы Windows** (`services.msc`) или pgAdmin. Для проверки соединения можно открыть SQL Shell под `our_memories` и базой `our_memories`.

### 2. Настройте переменные окружения

В корне проекта:

```powershell
Copy-Item .env.example .env
notepad .env
```

Пример важных строк:

```dotenv
DATABASE_URL=postgresql+psycopg://our_memories:ваш-пароль@localhost:5432/our_memories
JWT_SECRET=длинный-случайный-секрет-не-короче-32-символов
FRONTEND_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
```

Локально `COOKIE_SECURE=false` нужен для HTTP. На сервере с HTTPS установите `COOKIE_SECURE=true`, точный HTTPS-адрес в `FRONTEND_ORIGIN` и новый случайный `JWT_SECRET`.

### 3. Запустите backend

Из корня проекта:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
python -m app.cli create-admin
python -m app.cli seed-profiles
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Если PowerShell запрещает активацию, сначала выполните `Set-ExecutionPolicy -Scope Process Bypass`, затем повторите активацию. Эта настройка действует только в текущем окне терминала. Для проверки API откройте `http://localhost:8001/api/health`: ответ `{"status":"ok"}` означает, что API подключился к БД. Документация маршрутов — `http://localhost:8001/docs`.

Запланированные публикации выпускает отдельный процесс. В **новом** терминале из папки `backend` с активированным окружением запустите:

```powershell
python -m app.scheduler
```

Даже без него публикации с наступившей датой выходят при следующем запросе ленты; отдельный процесс делает это независимо от посещений сайта.

### 4. Запустите frontend

Откройте ещё один терминал в VS Code:

```powershell
cd frontend
npm install
npm run dev
```

Откройте **http://localhost:5173**. Vite пересылает запросы `/api` на FastAPI (`localhost:8001`), поэтому браузер работает с одним адресом и cookie. Фронтенд не содержит паролей БД и секретного ключа.

### 5. Создайте первое воспоминание

Войдите под главным администратором. В `/admin/profiles` можно изменить имена и аватары авторов. В `/admin/posts/new` выберите автора, добавьте текст, дату события и медиа, укажите доступ и нажмите «Сохранить публикацию». Для гостей видны только публикации с доступом «Публичная» после включения публичного режима в `/admin/settings`. Для приглашённых участников выбирайте «По приглашению». «Приватная» доступна администраторам.

Для загрузки фото и видео перетащите файлы в редактор или нажмите на область загрузки. Перед загрузкой изображение можно обрезать по центру в выбранном соотношении и повернуть. Поддерживаются JPG, PNG, WebP, MP4 и WebM, максимальный размер — 25 МБ. Добавьте альтернативный текст и выберите обложку. Файлы хранятся отдельно в `backend/uploads` или Docker-томе `media_data`; БД хранит метаданные и связи.

Участника приглашают в `/admin/users`. Скопируйте созданную ссылку и передайте её лично. После входа участник может комментировать доступные записи, отвечать на комментарии, ставить реакции и сохранять избранное. Для восстановления доступа администратор создаёт приглашение на уже существующий email: переход по ссылке задаёт новый пароль и завершает старые сессии.

Восстановить доступ администратора через приглашение может только главный администратор. Для главного администратора, если вход утрачен, запустите на сервере `python -m app.cli reset-admin-password --email ваш-email` из папки `backend` с активированным окружением. Команда запросит новый пароль скрытым вводом и завершит старые сессии.

## Роли и приватность

| Роль | Доступ |
| --- | --- |
| Главный администратор | Весь контент, настройки сайта, приглашение администраторов |
| Администратор | Публикации, профили, медиа, комментарии, приглашения участников |
| Участник по приглашению | Публичные и приглашённые публикации, комментарии, реакции, избранное |
| Гость | Только публичные публикации, если открыт публичный режим |

Аккаунт, созданный через открытую регистрацию, не получает доступ к личным публикациям автоматически. Приватные медиа отдаются через проверяемый API-маршрут. Для сессий используются короткий access token, обновляемый refresh token в HttpOnly cookie и CSRF-токен. Пароли хешируются Argon2. Удаление поста мягкое; файл удаляется из медиатеки только если нигде не используется.

## Структура

```text
our-story/
├── backend/
│   ├── alembic/              # миграции
│   ├── app/                  # модели, схемы, API, сессии, CLI, планировщик
│   ├── tests/                # интеграционные тесты API
│   └── requirements.txt
├── frontend/
│   ├── src/components/       # карточка публикации, комментарии
│   ├── src/pages/            # лента, галерея, календарь, админка
│   ├── src/lib/              # типы и HTTP-клиент
│   └── package.json
├── docker-compose.yml
└── .env.example
```

Проверки:

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
cd ..\frontend
npm test
npm run build
npm audit
```

## Если что-то не запускается

| Ошибка | Что проверить |
| --- | --- |
| `connection refused` к PostgreSQL | Запущена ли служба PostgreSQL, верен ли порт `5432`, совпадают ли пользователь, пароль и имя БД в `.env` |
| Ошибка CORS или `Недоверенный источник` | `FRONTEND_ORIGIN` должен в точности совпадать с адресом фронтенда; для Vite это `http://localhost:5173`, для Docker — `FRONTEND_ORIGIN_DOCKER=http://localhost:8080` |
| `ModuleNotFoundError` | Активируйте `.venv` и проверьте, что запускаете команды из папки `backend` |
| `npm install` не скачивает пакеты | Проверьте Node.js, сеть и доступ к `registry.npmjs.org`; затем повторите `npm install` |
| Ошибка миграции | Проверьте `DATABASE_URL`, что база существует и роль владеет ею; затем выполните `alembic upgrade head` из `backend` |
| Фото не загружается | Проверьте формат, лимит 25 МБ, свободное место в `UPLOAD_DIR` и вход под администратором |
| Не удаётся войти | Проверьте email и пароль, cookie браузера, правильный `JWT_SECRET` и адрес сайта; создайте новую ссылку приглашения для сброса пароля |

## Публикация на VPS

1. Настройте домен и HTTPS через обратный прокси (например, Nginx с сертификатом Let's Encrypt). Проксируйте домен на `127.0.0.1:8080`. Не открывайте наружу порты PostgreSQL и FastAPI; Compose уже привязывает их к localhost.
2. Задайте отдельные сложные `POSTGRES_PASSWORD` и `JWT_SECRET`, `COOKIE_SECURE=true`, `FRONTEND_ORIGIN_DOCKER=https://ваш-домен` и `FRONTEND_ORIGIN=https://ваш-домен`. Проверьте HTTPS до входа пользователей.
3. Ограничьте доступ к `.env`, Docker-томам и резервным копиям. База хранится в `postgres_data`, файлы — в `media_data`; резервировать нужно оба. Пример дампа БД: `docker compose exec -T db pg_dump -U our_memories our_memories > backup.sql`. Храните копию вне VPS и регулярно проверяйте восстановление.
4. Перед обновлением снимайте резервную копию, затем выполняйте `docker compose up --build -d`. При переносе на другой сервер восстановите БД и медиа, не меняя `JWT_SECRET` без необходимости завершить текущие сессии.

Публичный режим включает главный администратор в настройках после проверки содержимого публикаций и медиа.

