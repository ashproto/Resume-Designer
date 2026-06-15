mod commands;

// `Manager` is used by the desktop `app.manage(...)` call in `setup` and by the
// macOS-only Reopen handler below. Gating to `desktop` keeps it out of mobile
// builds (where neither exists) without tripping an unused-import warning.
#[cfg(desktop)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .manage(commands::PendingPdfPath::default())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.manage(commands::updater::PendingUpdate::default());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_pdf_save_path,
            commands::capture_pdf_from_window,
            commands::migration::probe_legacy_electron_data,
            commands::migration::import_legacy_electron_data,
            commands::storage::storage_load_all,
            commands::storage::storage_write,
            commands::storage::storage_delete,
            commands::storage::storage_clear,
            #[cfg(desktop)]
            commands::updater::check_update_on_channel,
            #[cfg(desktop)]
            commands::updater::install_pending_update,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            commands::typst_compile::typst_render_preview,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            commands::typst_compile::typst_export_pdf
        ]);

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            let _ = (app_handle, event);
        });
}
