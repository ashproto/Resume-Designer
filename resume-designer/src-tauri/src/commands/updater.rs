//! Runtime-selectable updater channel.
//!
//! The renderer picks a channel (`stable` | `beta`) and we build the updater
//! with that channel's endpoint, so a single installed build can switch
//! channels without reinstalling. The JS `plugin-updater` `check()` cannot
//! override endpoints, so channel selection has to happen here in Rust.
//!
//! Desktop-only: `tauri-plugin-updater` is a `cfg(desktop)` dependency, and
//! `UpdaterExt` only exists there.

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

// GitHub's `/releases/latest` redirect excludes pre-releases, so stable users
// never see beta builds; the beta channel reads the rolling `next` pre-release.
const STABLE_ENDPOINT: &str =
    "https://github.com/SiriusA7/Resume-Designer/releases/latest/download/latest.json";
const BETA_ENDPOINT: &str =
    "https://github.com/SiriusA7/Resume-Designer/releases/download/next/latest.json";

fn endpoint_for(channel: &str) -> &'static str {
    match channel {
        "beta" | "next" => BETA_ENDPOINT,
        _ => STABLE_ENDPOINT,
    }
}

/// Holds the update found by `check_update_on_channel` until
/// `install_pending_update` consumes it. The renderer shows a "download now?"
/// prompt between the two steps, mirroring the documented Tauri updater flow.
#[derive(Default)]
pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
}

/// Streamed to the renderer during download so it can render progress. The
/// shape matches the old `plugin-updater` `downloadAndInstall` events
/// (PascalCase `event` tag, camelCase data fields) so the renderer's existing
/// switch handles it unchanged.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

/// Check the given channel's endpoint for an update. Stores the result (if any)
/// in `PendingUpdate` and returns lightweight metadata for the renderer.
#[tauri::command]
pub async fn check_update_on_channel(
    app: AppHandle,
    channel: String,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let url = Url::parse(endpoint_for(&channel)).map_err(|e| e.to_string())?;
    let update = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
    });

    *pending
        .0
        .lock()
        .map_err(|_| "pending-update lock poisoned".to_string())? = update;

    Ok(info)
}

/// Download + install the update stashed by `check_update_on_channel`,
/// streaming progress over `on_event`. The renderer triggers the restart
/// afterwards via the process plugin (unchanged from the prior flow).
#[tauri::command]
pub async fn install_pending_update(
    pending: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|_| "pending-update lock poisoned".to_string())?
        .take()
        .ok_or_else(|| "no pending update to install".to_string())?;

    let mut started = false;
    let progress = on_event.clone();
    let finish = on_event.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = progress.send(DownloadEvent::Started { content_length });
                }
                let _ = progress.send(DownloadEvent::Progress { chunk_length });
            },
            move || {
                let _ = finish.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
