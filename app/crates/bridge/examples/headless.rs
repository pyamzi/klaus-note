//! A window-free development server for disposable test collections.
//! Usage: cargo run -p klaus-bridge --example headless -- "$TMPDIR/klaus-scratch"
//! Build frontend/native resources first; never use a real user profile here.
use std::{path::PathBuf, sync::Arc};
use klaus_bridge::{new_token, serve, Bridge, Hook, WebDirs};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = PathBuf::from(std::env::args().nth(1).ok_or("Provide a disposable collection directory")?);
    std::fs::create_dir_all(&directory)?;
    let directory = directory.canonicalize()?;
    if !directory.starts_with(std::env::temp_dir().canonicalize()?) {
        return Err("Headless tests require a directory under the system temporary directory".into());
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/debug");
    let bridge = Arc::new(Bridge::new()?);
    bridge.open_collection(&directory).map_err(|e| format!("{e:?}"))?;
    let token = new_token();
    let hook: Hook = Arc::new(|_, _| None);
    let (address, server) = serve(bridge, WebDirs {
        klaus: root.join("web"), anki: root.join("anki-web"), anki_static: root.join("anki-static"),
    }, token.clone(), hook).await?;
    // Contains a session credential. Keep this log local and never paste it into reports.
    println!("KlausNote dev URL: http://{address}/?t={token}");
    server.await?;
    Ok(())
}
