# Railway deployment

Deploy four services in one Railway project and environment. Keep only the
`frontend` service public. The repository's `docker-compose.yml` remains for
local Docker and VPS use; create Railway services separately because their
network and storage settings differ.

| Service | Source directory | Start command | Storage |
| --- | --- | --- | --- |
| `postgres` | Railway PostgreSQL template | Managed by Railway | PostgreSQL volume |
| `backend` | `/backend` | Dockerfile default: migrate, then start API | Volume at `/app/uploads` |
| `frontend` | `/frontend` | Dockerfile default: Nginx | None |
| `scheduler` | `/backend` | `python -m app.scheduler` | None |

Set these variables on `backend`:

```text
DATABASE_URL=${{postgres.DATABASE_URL}}
JWT_SECRET=<random value of at least 32 characters>
FRONTEND_ORIGIN=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
COOKIE_SECURE=true
UPLOAD_DIR=/app/uploads
MAX_UPLOAD_MB=25
PORT=8000
```

Set these variables on `frontend`:

```text
BACKEND_HOST=${{backend.RAILWAY_PRIVATE_DOMAIN}}:8000
```

Set this variable on `scheduler`:

```text
DATABASE_URL=${{postgres.DATABASE_URL}}
```

Generate a public HTTPS domain for `frontend`, directed to container port 80.
Do not generate public domains for `backend`, `scheduler`, or `postgres`.
The Nginx container forwards `/api/` to the backend over Railway's private
network. The backend accepts Railway's standard PostgreSQL URL and uses
`psycopg` as the driver.

After deployment, verify `https://<frontend-domain>/api/health` returns
`{"status":"ok"}` and that the site loads. For an empty database, run
`python -m app.cli create-admin` in the backend container; the command asks
for the password interactively. To retain existing local content, restore a
PostgreSQL dump and copy the local `backend/uploads` files into the backend
volume before first use. Never upload `.env`, database dumps, or media files
to a public source repository.
