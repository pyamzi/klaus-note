//! Native menus keep text editing in the webview's responder chain. Collection
//! history is an explicit, separate action handled by the current study screen.

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub fn install(app: &AppHandle, token: &str) -> tauri::Result<()> {
    // WKWebView windows may not share the session cookie immediately. Authorize
    // this window through the same one-launch token exchange as the main window.
    let mut settings_url = app.state::<Url>().join("settings").expect("valid settings path");
    settings_url.set_query(Some(&format!("window=1&t={token}")));
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let application = SubmenuBuilder::new(app, "KlausNote")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .text("collection-undo", "Undo Collection Change")
        .text("collection-redo", "Redo Collection Change")
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .fullscreen()
        .close_window()
        .build()?;
    let menu = MenuBuilder::new(app).items(&[&application, &edit, &window]).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(move |app, event| match event.id().as_ref() {
        "settings" => {
            if let Err(error) = open_settings(app, settings_url.clone()) {
                eprintln!("Could not open settings: {error}");
            }
        }
        "collection-undo" => collection_history(app, "undo"),
        "collection-redo" => collection_history(app, "redo"),
        _ => {}
    });
    Ok(())
}

fn open_settings(app: &AppHandle, url: Url) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show()?;
        return window.set_focus();
    }
    // A second window leaves Add's unsaved fields and Browse's active editor intact.
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::External(url))
        .title("Settings · KlausNote")
        .inner_size(650.0, 780.0)
        .min_inner_size(420.0, 480.0)
        .build()?;
    Ok(())
}

fn collection_history(app: &AppHandle, action: &str) {
    let Some(window) = app.get_webview_window("main") else { return };
    // Never change the collection while a settings or other auxiliary window is focused.
    if !window.is_focused().unwrap_or(false) { return; }
    // Only these screens have a handler that saves pending edits and refreshes state.
    let Ok(url) = window.url() else { return };
    if !matches!(url.path(), "/" | "/browse" | "/browse/" | "/review" | "/review/") { return; }
    let _ = window.eval(&format!(
        "window.dispatchEvent(new CustomEvent('klaus-collection-history', {{ detail: '{action}' }}));"
    ));
}

pub fn publish_fullscreen(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    if let Ok(fullscreen) = window.is_fullscreen() {
        let _ = window.eval(&format!(
            "window.__klausFullscreen = {fullscreen}; window.dispatchEvent(new CustomEvent('klaus-fullscreen', {{ detail: {fullscreen} }}));"
        ));
    }
}
