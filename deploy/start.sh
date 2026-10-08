#!/bin/sh
# Container entry point: bring the database schema up to date, then serve.
# Migrations are idempotent, so running them on every start is safe, and it
# means a deploy never serves code newer than its schema.
set -e
cd /app/backend
alembic upgrade head
exec uvicorn app.asgi:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips='*'
