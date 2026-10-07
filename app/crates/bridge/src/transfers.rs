//! Native-selected package transfers and Anki's periodic, no-media backups.
use std::path::Path;
use std::sync::Arc;

use anki_proto::collection::{CloseCollectionRequest, CreateBackupRequest, OpenCollectionRequest};
use anki_proto::generic;
use anki_proto::import_export::{
    export_limit, ExportAnkiPackageOptions, ExportAnkiPackageRequest,
    ExportCollectionPackageRequest, ExportLimit, ImportCollectionPackageRequest,
};

use crate::{path_str, Bridge, CallError};

impl Bridge {
    fn transfer_dir(&self) -> Result<std::path::PathBuf, CallError> {
        self.dir.lock().unwrap().clone().ok_or_else(|| CallError::Backend("No collection is open.".into()))
    }

    fn reopen_after_transfer(&self, dir: &Path) -> Result<(), CallError> {
        self.rpc::<_, generic::Empty>("openCollection", OpenCollectionRequest {
            collection_path: path_str(&dir.join("collection.anki2")),
            media_folder_path: path_str(&dir.join("collection.media")),
            media_db_path: path_str(&dir.join("collection.media.db2")),
        }).map(drop)
    }

    fn create_transfer_backup(&self, force: bool) -> Result<bool, CallError> {
        let folder = self.transfer_dir()?.join("backups");
        std::fs::create_dir_all(&folder).map_err(io_error)?;
        self.rpc::<_, generic::Bool>("createBackup", CreateBackupRequest {
            backup_folder: path_str(&folder), force, wait_for_completion: true,
        }).map(|result| result.val)
    }

    /// The shell supplies the path after a native save dialog. All scheduling and
    /// media are included, so an export can also be used to move a study history.
    pub fn export_package(&self, path: &Path, format: &str, deck_id: Option<i64>) -> Result<(), CallError> {
        if !matches!(format, "apkg" | "colpkg") || path.extension().and_then(|v| v.to_str()) != Some(format) {
            return Err(CallError::Backend("Choose an .apkg or .colpkg filename matching the export format.".into()));
        }
        if format == "colpkg" && deck_id.is_some() {
            return Err(CallError::Backend("A collection backup includes every deck.".into()));
        }
        if deck_id.is_some_and(|id| id <= 0) {
            return Err(CallError::Backend("Choose a valid deck.".into()));
        }
        let _access = self.collection_access.write().unwrap();
        let dir = self.transfer_dir()?;
        let parent = path.parent().ok_or_else(|| CallError::Backend("Choose an export folder.".into()))?;
        let parent = parent.canonicalize().map_err(io_error)?;
        if parent.starts_with(dir.canonicalize().map_err(io_error)?) {
            return Err(CallError::Backend("Save exports outside the app's collection folder.".into()));
        }
        // Publish only complete packages. A failed export must not truncate an
        // existing destination selected in the native save dialog.
        let temporary = parent.join(format!(".klaus-export-{}.{}", crate::new_token(), format));
        let result = if format == "apkg" {
            let limit = match deck_id {
                Some(id) => export_limit::Limit::DeckId(id),
                None => export_limit::Limit::WholeCollection(generic::Empty {}),
            };
            self.rpc::<_, generic::UInt32>("exportAnkiPackage", ExportAnkiPackageRequest {
                out_path: path_str(&temporary),
                options: Some(ExportAnkiPackageOptions {
                    with_scheduling: true, with_deck_configs: true, with_media: true, legacy: false,
                }),
                limit: Some(ExportLimit { limit: Some(limit) }),
            }).map(drop)
        } else {
            // Anki consumes and closes its Collection while exporting colpkg,
            // including on export failure. Reopen before releasing the gate.
            let exported = self.rpc::<_, generic::Empty>("exportCollectionPackage", ExportCollectionPackageRequest {
                out_path: path_str(&temporary), include_media: true, legacy: false,
            }).map(drop);
            combine_reopen(exported, self.reopen_after_transfer(&dir))
        };
        let result = result.and_then(|_| std::fs::rename(&temporary, path).map_err(io_error));
        if result.is_err() { let _ = std::fs::remove_file(&temporary); }
        result
    }

    /// Called only after the shell confirms replacing the current collection.
    /// Anki validates a temporary database before atomically replacing the old
    /// file. Reopening on failure leaves the previous collection usable.
    pub fn import_collection_package(&self, path: &Path) -> Result<(), CallError> {
        let _access = self.collection_access.write().unwrap();
        let dir = self.transfer_dir()?;
        // A forced backup also prunes old backups. Preserve the selected bytes
        // before that step, including when restoring from the backups folder.
        let staged_path = dir.join(format!(".klaus-restore-{}.colpkg", crate::new_token()));
        let mut source = std::fs::File::open(path).map_err(io_error)?;
        let mut destination = std::fs::OpenOptions::new().write(true).create_new(true)
            .open(&staged_path).map_err(io_error)?;
        let staged = StagedPackage(staged_path);
        std::io::copy(&mut source, &mut destination).map_err(io_error)?;
        drop(destination);
        drop(source);
        self.create_transfer_backup(true)?;
        self.rpc::<_, generic::Empty>("closeCollection", CloseCollectionRequest { downgrade_to_schema11: false })?;
        let imported = self.rpc::<_, generic::Empty>("importCollectionPackage", ImportCollectionPackageRequest {
            col_path: path_str(&dir.join("collection.anki2")),
            backup_path: path_str(&staged.0),
            media_folder: path_str(&dir.join("collection.media")),
            media_db: path_str(&dir.join("collection.media.db2")),
        }).map(drop);
        combine_reopen(imported, self.reopen_after_transfer(&dir))
    }

    /// Anki decides whether data changed and the configured interval elapsed,
    /// and applies its daily/weekly/monthly retention limits to completed files.
    pub fn auto_backup_tick(&self) -> Result<bool, CallError> {
        let _access = match self.collection_access.try_write() {
            Ok(access) => access,
            Err(_) => return Ok(false),
        };
        if self.sync.quitting.load(std::sync::atomic::Ordering::SeqCst) { return Ok(false); }
        self.create_transfer_backup(false)
    }

    pub fn start_auto_backups(self: &Arc<Self>) {
        let weak = Arc::downgrade(self);
        std::thread::spawn(move || loop {
            let Some(bridge) = weak.upgrade() else { break };
            if bridge.sync.quitting.load(std::sync::atomic::Ordering::SeqCst) { break; }
            if let Err(error) = bridge.auto_backup_tick() {
                eprintln!("KlausNote automatic backup failed: {error:?}");
            }
            drop(bridge);
            std::thread::sleep(std::time::Duration::from_secs(60));
        });
    }
}

fn io_error(error: std::io::Error) -> CallError { CallError::Backend(error.to_string()) }

fn combine_reopen(result: Result<(), CallError>, reopened: Result<(), CallError>) -> Result<(), CallError> {
    match (result, reopened) {
        (_, Err(error)) => Err(CallError::Backend(format!("The collection could not be reopened: {error:?}. Restart KlausNote before continuing."))),
        (result, Ok(())) => result,
    }
}

/// Removed after either a successful restore or any early return.
struct StagedPackage(std::path::PathBuf);
impl Drop for StagedPackage {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
}
