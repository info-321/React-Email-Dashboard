# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS client-build
WORKDIR /build/client
ENV CI=true
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/public ./public
COPY client/src ./src
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_BUILD_DIR=/app/client/build \
    EMAIL_STORE=/app/data/emails.json \
    GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/workspace_service_account.json \
    SESSION_COOKIE_SECURE=true
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt \
    && groupadd --gid 10001 eworkspace \
    && useradd --uid 10001 --gid 10001 --no-create-home eworkspace \
    && install -d -o 10001 -g 10001 -m 0700 /app/data \
    && install -d -m 0755 /run/secrets \
    && touch /run/secrets/workspace_service_account.json
COPY server/app.py server/analytics_sample.json ./server/
# Use environment configuration; never copy the developer's private config.
COPY server/config.example.py ./server/config.py
COPY --from=client-build /build/client/build ./client/build
USER 10001:10001
WORKDIR /app/server
EXPOSE 8000
# The JSON mailbox registry currently requires serialized writes.
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "1", "--timeout", "180", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
