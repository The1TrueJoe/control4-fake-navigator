# ---- build the React UI ----
FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- build the Rust backend (uses the lib submodule at ../lib) ----
FROM rust:1-slim AS backend
WORKDIR /app
COPY lib/ ./lib/
COPY backend/ ./backend/
WORKDIR /app/backend
RUN cargo build --release

# ---- runtime ----
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/backend/target/release/c4-fake-navigator-backend /usr/local/bin/fake-nav
COPY --from=frontend /app/frontend/dist /app/web
ENV WEB_DIR=/app/web SINK_ADDR=0.0.0.0:9010 HTTP_ADDR=0.0.0.0:8080
EXPOSE 8080 9010
CMD ["fake-nav"]
