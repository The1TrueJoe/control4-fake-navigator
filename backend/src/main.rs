//! control4-fake-navigator backend.
//!
//! - Runs the sink server (receives nav keys relayed by the on-screen DriverWorks
//!   driver) — `control4-navigator-sink-lib`.
//! - Live-syncs the Control4 project + room state over the REST API (Strategy A).
//! - Serves the React UI and streams a unified feed (snapshot + nav events +
//!   room-state updates) to it over a websocket.
//!
//! Config via env:
//!   C4_HOST    e.g. https://10.0.0.107   (Control4 controller)
//!   C4_TOKEN   Bearer JWT (see lib docs/navigator-data-model.md to mint one)
//!   SINK_ADDR  default 0.0.0.0:9010      (driver connects here)
//!   HTTP_ADDR  default 0.0.0.0:8080      (UI + websocket)
//!   WEB_DIR    default ../frontend/dist  (built React app; optional in dev)

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use control4_navigator_sink_lib as c4;
use serde::Serialize;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::broadcast;

/// Messages pushed to the UI over the websocket.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMsg {
    /// Full current state, sent on connect and after a project resync.
    Snapshot {
        project: c4::Project,
        nav: c4::NavigatorState,
    },
    /// A live navigation/command event from the driver relay.
    Event { event: EventDto },
    /// Live navigator state changed (binding/nav-room/last-key/popup…).
    Nav { nav: c4::NavigatorState },
}

/// Flattened, UI-friendly view of a relay [`c4::Event`].
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
        match e {
            Nav { room, key } => EventDto {
                kind: "nav".into(),
                key: Some(key.as_command().into()),
                room: *room,
                command: None,
            },
            EnterNavigation { room } => EventDto {
                kind: "enter_navigation".into(),
                key: None,
                room: Some(*room),
                command: None,
            },
            ExitNavigation { room } => EventDto {
                kind: "exit_navigation".into(),
                key: None,
                room: *room,
                command: None,
            },
            Binding { binding, class, bound } => EventDto {
                kind: if *bound { "bind" } else { "unbind" }.into(),
                key: None,
                room: None,
                command: Some(format!("{class}:{binding}")),
            },
            Popup { show, .. } => EventDto {
                kind: if *show { "popup_show" } else { "popup_hide" }.into(),
                key: None,
                room: None,
                command: None,
            },
            other => EventDto {
                kind: "other".into(),
                key: None,
                room: None,
                command: Some(format!("{other:?}")),
            },
        }
    }
}

#[derive(Clone)]
struct AppState {
    project: Arc<RwLock<c4::Project>>,
    nav: Arc<RwLock<c4::NavigatorState>>,
    tx: broadcast::Sender<ServerMsg>,
}

/// A [`c4::ProjectSource`] backed by the controller's REST API.
struct C4Api {
    base: String,
    token: String,
    http: reqwest::blocking::Client,
}

impl c4::ProjectSource for C4Api {
    fn get_json(&self, path: &str) -> c4::Result<serde_json::Value> {
        let io = |e: String| c4::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e));
        let resp = self
            .http
            .get(format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
            .send()
            .map_err(|e| io(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(io(format!("GET {path} -> {}", resp.status())));
        }
        resp.json().map_err(|e| io(e.to_string()))
    }
}

#[tokio::main]
async fn main() {
    let sink_addr = env_or("SINK_ADDR", "0.0.0.0:9010");
    let http_addr = env_or("HTTP_ADDR", "0.0.0.0:8080");
    let web_dir = env_or("WEB_DIR", "../frontend/dist");

    let (tx, _rx) = broadcast::channel::<ServerMsg>(256);
    let state = AppState {
        project: Arc::new(RwLock::new(c4::Project::default())),
        nav: Arc::new(RwLock::new(c4::NavigatorState::new())),
        tx: tx.clone(),
    };

    // Sink: receive the driver relay on a std thread, fold + broadcast.
    spawn_sink(state.clone(), sink_addr.clone());
    // Project sync: poll the REST API if configured.
    spawn_project_sync(state.clone());

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

fn spawn_project_sync(state: AppState) {
    let (host, token) = (std::env::var("C4_HOST").ok(), std::env::var("C4_TOKEN").ok());
    let (Some(host), Some(token)) = (host, token) else {
        println!("[sync] C4_HOST/C4_TOKEN not set — project stays empty (nav events still stream)");
        return;
    };
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
            match c4::load_project(&api) {
                Ok(mut project) => {
                    // fold live room variables
                    let room_ids: Vec<u32> = project.rooms.keys().copied().collect();
                    for rid in room_ids {
                        if let Ok(vars) = c4::load_room_variables(&api, rid) {
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
            std::thread::sleep(Duration::from_secs(15));
        }
    });
}

async fn state_handler(State(s): State<AppState>) -> impl IntoResponse {
    let snap = ServerMsg::Snapshot {
        project: s.project.read().unwrap().clone(),
        nav: s.nav.read().unwrap().clone(),
    };
    axum::Json(snap)
}

async fn ws_handler(ws: WebSocketUpgrade, State(s): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws_loop(socket, s))
}

async fn ws_loop(mut socket: WebSocket, s: AppState) {
    // Send an initial snapshot.
    let snap = ServerMsg::Snapshot {
        project: s.project.read().unwrap().clone(),
        nav: s.nav.read().unwrap().clone(),
    };
    if socket
        .send(Message::Text(serde_json::to_string(&snap).unwrap()))
        .await
        .is_err()
    {
        return;
    }
    // Stream updates.
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
                Some(Ok(_)) => {} // ignore client->server for now
                _ => break,
            }
        }
    }
}
