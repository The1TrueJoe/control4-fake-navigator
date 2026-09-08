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

## Run (dev)

Terminal 1 — backend (serves ws/REST on :8080, sink on :9010):
```sh
cd backend
C4_HOST=https://10.0.0.107 C4_TOKEN=<jwt> cargo run
```
Terminal 2 — frontend (Vite dev at :5173, proxies ws/REST to :8080):
```sh
cd frontend
npm install
npm run dev
```
Open http://localhost:5173. Point the on-screen driver's Target IP/Port at this
host and :9010; press the room's C4 button and navigate with the remote.

## Run (prod / on the Pi)
```sh
cd frontend && npm install && npm run build      # -> frontend/dist
cd ../backend && C4_HOST=https://<controller> C4_TOKEN=<jwt> \
  WEB_DIR=../frontend/dist HTTP_ADDR=0.0.0.0:8080 cargo run --release
```
Then run WebKit/Chromium in kiosk mode at `http://localhost:8080`.

## Config (backend env)
| Var | Default | Meaning |
|---|---|---|
| `C4_HOST` | (unset) | Controller base URL, e.g. `https://10.0.0.107`. Unset ⇒ project empty, nav events still stream. |
| `C4_TOKEN` | (unset) | Bearer JWT for the REST API. |
| `SINK_ADDR` | `0.0.0.0:9010` | Where the driver connects. |
| `HTTP_ADDR` | `0.0.0.0:8080` | UI + websocket. |
| `WEB_DIR` | `../frontend/dist` | Built React app. |

### Getting `C4_TOKEN`
The REST API needs a Bearer JWT (`POST /api/v1/localjwt`, client-cert gated). See
`lib/docs/navigator-data-model.md` → "Auth". Without it the UI still runs and shows
live nav from the driver; rooms/devices populate once the token is set.

## Status
End-to-end proven: driver relay → sink → backend → websocket → UI, room-aware, remote-driven.
Next: reverse channel (UI → driver → Director) for `SELECT_SOURCE`/commands, and the
`/api/v1/subscriptions` push feed for instant variable updates (currently polled).
