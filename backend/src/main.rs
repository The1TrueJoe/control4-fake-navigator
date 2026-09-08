//! control4-fake-navigator backend.
//!
//! - Sink server: receives nav keys relayed by the on-screen DriverWorks driver.
//! - REST live-sync: loads the Control4 project + room state (Strategy A).
//! - Websocket: streams snapshot + nav events + state to the React UI.
//! - Reverse channel: UI actions -> Control4 commands (`POST /items/:id/commands`).
//!
//! All controller HTTP (reqwest::blocking) runs on ONE dedicated std thread — never
//! inside the tokio runtime (reqwest::blocking panics there). The ws handler submits
//! commands to that thread over a channel.
//!
//! Env: C4_HOST, C4_TOKEN, SINK_ADDR (0.0.0.0:9010), HTTP_ADDR (0.0.0.0:8080), WEB_DIR.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use control4_navigator_sink_lib as c4;
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMsg {
    Snapshot { project: c4::Project, nav: c4::NavigatorState },
    Event { event: EventDto },
    Nav { nav: c4::NavigatorState },
    CommandAck { ok: bool, item: u32, command: String, error: Option<String> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Command {
        item: u32,
        command: String,
        #[serde(default)]
        params: serde_json::Value,
    },
}

/// A reverse-channel command request handed to the control thread.
struct CmdReq {
    item: u32,
    command: String,
    params: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
struct EventDto {
    kind: String,
    key: Option<String>,
    room: Option<u32>,
    command: Option<String>,
}

impl From<&c4::Event> for EventDto {
    fn from(e: &c4::Event) -> Self {
        use c4::Event::*;
        let mut d = EventDto { kind: "other".into(), key: None, room: None, command: None };
        match e {
            Nav { room, key } => {
                d.kind = "nav".into();
                d.key = Some(key.as_command().into());
                d.room = *room;
            }
            EnterNavigation { room } => {
                d.kind = "enter_navigation".into();
                d.room = Some(*room);
            }
            ExitNavigation { room } => {
                d.kind = "exit_navigation".into();
                d.room = *room;
            }
            Binding { binding, class, bound } => {
                d.kind = if *bound { "bind" } else { "unbind" }.into();
                d.command = Some(format!("{class}:{binding}"));
            }
            Popup { show, .. } => d.kind = if *show { "popup_show" } else { "popup_hide" }.into(),
            other => d.command = Some(format!("{other:?}")),
        }
        d
    }
}

struct C4Api {
    base: String,
    token: String,
    http: reqwest::blocking::Client,
}

impl C4Api {
    fn io(e: String) -> c4::Error {
        c4::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e))
    }
    fn send_command(&self, item: u32, command: &str, params: &serde_json::Value) -> c4::Result<()> {
        let body = serde_json::json!({ "command": command, "params": params });
        let resp = self
            .http
            .post(format!("{}/api/v1/items/{item}/commands", self.base))
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .map_err(|e| Self::io(e.to_string()))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(Self::io(format!("{} -> {}", command, resp.status())))
        }
    }
}

impl c4::ProjectSource for C4Api {
    fn get_json(&self, path: &str) -> c4::Result<serde_json::Value> {
        let resp = self
            .http
            .get(format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
            .send()
            .map_err(|e| Self::io(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(Self::io(format!("GET {path} -> {}", resp.status())));
        }
        resp.json().map_err(|e| Self::io(e.to_string()))
    }
}

/// Serves a bundled sample project (captured from a real EA-3) so the UI can be
/// tested with no controller or token. Active when C4_HOST/C4_TOKEN are unset.
struct DemoSource;

impl c4::ProjectSource for DemoSource {
    fn get_json(&self, path: &str) -> c4::Result<serde_json::Value> {
        let body = match path {
            "/api/v1/rooms" => include_str!("../demo/rooms.json"),
            "/api/v1/items?tree=false" => include_str!("../demo/items.json"),
            "/api/v1/items/14/variables" => include_str!("../demo/room-14-variables.json"),
            "/api/v1/items/31/variables" => include_str!("../demo/room-31-variables.json"),
            _ => "[]",
        };
        serde_json::from_str(body).map_err(|e| C4Api::io(e.to_string()))
    }
}

#[derive(Clone)]
struct AppState {
    project: Arc<RwLock<c4::Project>>,
    nav: Arc<RwLock<c4::NavigatorState>>,
    tx: broadcast::Sender<ServerMsg>,
    cmd_tx: Option<mpsc::Sender<CmdReq>>,
}

#[tokio::main]
async fn main() {
    let sink_addr = env_or("SINK_ADDR", "0.0.0.0:9010");
    let http_addr = env_or("HTTP_ADDR", "0.0.0.0:8080");
    let web_dir = env_or("WEB_DIR", "../frontend/dist");

    let (tx, _rx) = broadcast::channel::<ServerMsg>(256);
    // docker-compose passes `${C4_HOST:-}` as an empty string when no .env is set,
    // and copy/paste often leaves quotes or a trailing newline — treat all of those
    // as "unset" so we cleanly fall back to demo mode instead of erroring.
    let creds = (env_clean("C4_HOST"), env_clean("C4_TOKEN"));
    let cmd_tx = match creds {
        (Some(host), Some(token)) => {
            let (ctx, crx) = mpsc::channel::<CmdReq>();
            Some((host, token, ctx, crx))
        }
        _ => {
            println!("[sync] C4_HOST/C4_TOKEN unset — no project sync / reverse commands");
            None
        }
    };

    let state = AppState {
        project: Arc::new(RwLock::new(c4::Project::default())),
        nav: Arc::new(RwLock::new(c4::NavigatorState::new())),
        tx: tx.clone(),
        cmd_tx: cmd_tx.as_ref().map(|(_, _, ctx, _)| ctx.clone()),
    };

    spawn_sink(state.clone(), sink_addr.clone());
    if let Some((host, token, _ctx, crx)) = cmd_tx {
        spawn_control(state.clone(), host, token, crx);
    } else {
        // Demo mode: populate the UI from the bundled sample project.
        sync_project(&DemoSource as &dyn c4::ProjectSource, &state);
        println!("[demo] serving bundled sample project — set C4_HOST/C4_TOKEN for live control");
    }

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/state", get(state_handler))
        .fallback_service(tower_http::services::ServeDir::new(web_dir))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&http_addr).await.expect("bind http");
    println!("[fake-nav] UI/ws on http://{http_addr}  (sink on {sink_addr})");
    axum::serve(listener, app).await.unwrap();
}

fn env_or(k: &str, d: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| d.to_string())
}

/// Read an env var, trim whitespace and surrounding quotes, and return `None` if
/// the result is empty (so `${VAR:-}` / blank .env values behave as unset).
fn env_clean(k: &str) -> Option<String> {
    std::env::var(k).ok().and_then(|v| {
        let s = v.trim().trim_matches(['"', '\'']).trim().to_string();
        (!s.is_empty()).then_some(s)
    })
}

fn spawn_sink(state: AppState, addr: String) {
    std::thread::spawn(move || {
        let rx = match c4::SinkServer::listen(&addr) {
            Ok(rx) => rx,
            Err(e) => {
                eprintln!("[sink] bind {addr} failed: {e}");
                return;
            }
        };
        for msg in rx {
            if let c4::SinkEvent::Event(ev) = msg {
                let changed = state.nav.write().unwrap().apply(&ev);
                let _ = state.tx.send(ServerMsg::Event { event: EventDto::from(&ev) });
                if changed {
                    let nav = state.nav.read().unwrap().clone();
                    let _ = state.tx.send(ServerMsg::Nav { nav });
                }
            }
        }
    });
}

/// The single controller-HTTP thread: builds the blocking client (outside tokio),
/// periodically syncs the project, and executes reverse-channel commands.
fn spawn_control(state: AppState, host: String, token: String, rx: mpsc::Receiver<CmdReq>) {
    std::thread::spawn(move || {
        let api = C4Api {
            base: host,
            token,
            http: reqwest::blocking::Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(Duration::from_secs(10))
                .build()
                .expect("http client"),
        };
        loop {
            sync_project(&api as &dyn c4::ProjectSource, &state);
            // Serve commands for ~15s, then resync.
            let deadline = Instant::now() + Duration::from_secs(15);
            loop {
                let now = Instant::now();
                if now >= deadline {
                    break;
                }
                match rx.recv_timeout(deadline - now) {
                    Ok(req) => {
                        let res = api.send_command(req.item, &req.command, &req.params);
                        let _ = state.tx.send(ServerMsg::CommandAck {
                            ok: res.is_ok(),
                            item: req.item,
                            command: req.command,
                            error: res.err().map(|e| e.to_string()),
                        });
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        }
    });
}

fn sync_project(api: &dyn c4::ProjectSource, state: &AppState) {
    match c4::load_project(api) {
        Ok(mut project) => {
            let room_ids: Vec<u32> = project.rooms.keys().copied().collect();
            for rid in room_ids {
                if let Ok(vars) = c4::load_room_variables(api, rid) {
                    if let Some(room) = project.rooms.get_mut(&rid) {
                        c4::apply_room_variables(room, &vars);
                    }
                }
            }
            *state.project.write().unwrap() = project.clone();
            let nav = state.nav.read().unwrap().clone();
            let _ = state.tx.send(ServerMsg::Snapshot { project, nav });
        }
        Err(e) => eprintln!("[sync] load_project: {e}"),
    }
}

async fn state_handler(State(s): State<AppState>) -> impl IntoResponse {
    axum::Json(ServerMsg::Snapshot {
        project: s.project.read().unwrap().clone(),
        nav: s.nav.read().unwrap().clone(),
    })
}

async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_loop(socket, s))
}

async fn ws_loop(mut socket: WebSocket, s: AppState) {
    let snap = ServerMsg::Snapshot {
        project: s.project.read().unwrap().clone(),
        nav: s.nav.read().unwrap().clone(),
    };
    if socket.send(Message::Text(serde_json::to_string(&snap).unwrap())).await.is_err() {
        return;
    }
    let mut rx = s.tx.subscribe();
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(m) => {
                    if socket.send(Message::Text(serde_json::to_string(&m).unwrap())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(t))) => handle_client_msg(&s, &t),
                Some(Ok(_)) => {}
                _ => break,
            }
        }
    }
}

fn handle_client_msg(s: &AppState, text: &str) {
    let Ok(ClientMsg::Command { item, command, params }) = serde_json::from_str::<ClientMsg>(text)
    else {
        return;
    };
    match &s.cmd_tx {
        Some(tx) => {
            let _ = tx.send(CmdReq { item, command, params });
        }
        None => {
            let _ = s.tx.send(ServerMsg::CommandAck {
                ok: false,
                item,
                command,
                error: Some("controller not configured (set C4_HOST/C4_TOKEN)".into()),
            });
        }
    }
}
