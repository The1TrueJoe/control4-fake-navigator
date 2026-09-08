# control4-fake-navigator

A DIY Control4 on-screen navigator: a **React/WebKit UI** (Norigin spatial
navigation) driven by a **Rust backend** that receives the room's remote keypresses
from the on-screen driver and live-syncs the Control4 project over the REST API.

It presents your Control4 project **your own way**, is **room-aware** (follows the
room the remote is controlling), and navigates with the physical remote — validated
end-to-end against a real controller.

```
 C4 remote ─▶ Director ─▶ ohc on-screen driver (controller proxy)
                              │ relays nav keys (NDJSON)
                              ▼
  backend (Rust, uses control4-navigator-sink-lib as a submodule)
    • sink server  : receives nav keys              (:9010)
    • REST sync    : loads rooms/items/variables    (Strategy A, live-sync)
    • websocket    : snapshot + events + state  ──▶ frontend
                              ▼
  frontend (React + Norigin spatial nav, WebKit kiosk)   (:8080 in prod, :5173 dev)
```

The shared protocol/model/loader lives in the **`lib/`** submodule
([control4-navigator-sink-lib](lib/README.md)).

## Layout
- `lib/` — submodule: wire protocol, sink, navigator model, REST loader
- `backend/` — Rust (axum) server: sink + REST sync + websocket + static serve
- `frontend/` — React + Vite + `@noriginmedia/norigin-spatial-navigation`

## Run it

Clone with the submodule: `git clone --recurse-submodules <url>` (or after clone:
`git submodule update --init`).

### 1. Demo mode (fastest — no controller, no token)
The backend bundles a **sample project** (real rooms/devices captured from an EA-3),
so you can test the whole UI immediately.

**Docker:**
```sh
docker compose up --build
```
**or local (no Docker):**
```sh
./run.sh
```
Open **http://localhost:8080** — you'll see rooms (Room, Bathroom) and their devices.
Arrow keys / Enter navigate (Norigin). This is the UI you'll ship.

### 2. Add the driver to Control4 (to drive it with the real remote)
1. Build/import the on-screen driver (`lib/driver/` → `ohc-nav-sink.c4z`) in Composer Pro.
2. Set its **Target IP Address** to the machine running this (your Mac/Pi's LAN IP)
   and **Target Port** to **9010**.
3. Bind **HDMI (Audio/Video)** to a TV input; the Onscreen Navigator auto-binds.
4. Press the room's **C4 / menu** button — nav keys now stream into the UI, and the
   status bar shows the room being navigated.

### 3. Go live (real project + control)
Provide a controller host + JWT so the UI shows your real project and tiles control
real devices (see token minting below):
```sh
# Docker: put these in a .env next to docker-compose.yml
C4_HOST=https://10.0.0.107
C4_TOKEN=<jwt>
docker compose up --build

# or local:
C4_HOST=https://10.0.0.107 C4_TOKEN=<jwt> ./run.sh
```

### Frontend dev server (hot reload, optional)
```sh
cd frontend && npm install && npm run dev    # http://localhost:5173, proxies to :8080
```
(run the backend separately as above.)

## Config (backend env)
| Var | Default | Meaning |
|---|---|---|
| `C4_HOST` | (unset) | Controller base URL, e.g. `https://10.0.0.107`. Unset ⇒ project empty, nav events still stream. |
| `C4_TOKEN` | (unset) | Bearer JWT for the REST API. |
| `SINK_ADDR` | `0.0.0.0:9010` | Where the driver connects. |
| `HTTP_ADDR` | `0.0.0.0:8080` | UI + websocket. |
| `WEB_DIR` | `../frontend/dist` | Built React app. |

### Getting `C4_TOKEN`
The REST API needs a Bearer JWT (`POST /api/v1/localjwt`, client-cert gated). Mint one:
```sh
C4_SSH_PASS='<controller root pw>' ./scripts/mint-token.sh --env   # writes .env
# or: C4_SSH_KEY=~/.ssh/ea3_key ./scripts/mint-token.sh --env
```
It SSHes to the controller and mints via the on-box `localjwt` header trick (see
`lib/docs/navigator-data-model.md` → "Auth"). The JWT lasts ~24h — re-run to refresh.
Without a token the UI still runs in demo mode and shows live nav from the driver.

## Status
End-to-end proven: driver relay → sink → backend → websocket → UI, room-aware, remote-driven.
Next: reverse channel (UI → driver → Director) for `SELECT_SOURCE`/commands, and the
`/api/v1/subscriptions` push feed for instant variable updates (currently polled).
