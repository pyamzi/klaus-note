use std::{fs, io::{Read, Write}, path::{Component, Path, PathBuf}, time::UNIX_EPOCH};

use anki_proto::generic;
use prost::Message;
use serde_json::{json, Value};

use crate::{Bridge, CallError, klaus::LibraryFile};

const MAX_PDF: usize = 128 * 1024 * 1024;

fn error(e: impl std::fmt::Display) -> CallError { CallError::Backend(e.to_string()) }

fn relative(path: &str) -> Result<&Path, CallError> {
    let path = Path::new(path);
    if path.components().any(|part| !matches!(part, Component::Normal(_))) || path.to_string_lossy().contains('\\') {
        return Err(error("Invalid Library path"));
    }
    Ok(path)
}

fn name(name: &str) -> Result<&str, CallError> {
    if name.trim().is_empty() || name.len() > 255 || relative(name)?.components().count() != 1 {
        return Err(error("Invalid Library name"));
    }
    Ok(name)
}

fn pdf(path: &Path) -> bool { path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")) }

// Reject symlink components as well as lexical traversal. This also prevents a
// Library link to collection.anki2 or another directory being served to a page.
fn resolve(root: &Path, path: &str) -> Result<PathBuf, CallError> {
    let mut resolved = root.to_path_buf();
    for part in relative(path)?.components() {
        resolved.push(part);
        if fs::symlink_metadata(&resolved).map_err(error)?.file_type().is_symlink() {
            return Err(error("Library symlinks are not supported"));
        }
    }
    let canonical = resolved.canonicalize().map_err(error)?;
    if !canonical.starts_with(root) { return Err(error("Path is outside the Library")); }
    Ok(canonical)
}

// Publishing a completed temporary file with hard_link is atomic and refuses
// an existing destination, even when another importer creates it concurrently.
fn import(path: &Path, data: &[u8]) -> Result<(), CallError> {
    let temp = path.parent().unwrap().join(format!(".klaus-import-{:016x}", rand::random::<u64>()));
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(error)?;
    let result = (|| {
        file.write_all(data).map_err(error)?;
        file.sync_all().map_err(error)?;
        fs::hard_link(&temp, path).map_err(error)
    })();
    let _ = fs::remove_file(&temp);
    result
}

impl Bridge {
    fn library_root(&self) -> Result<PathBuf, CallError> {
        let configured = self.profile("libraryRoot");
        let root = if let Some(path) = configured.as_str().filter(|path| !path.trim().is_empty()) {
            let path = PathBuf::from(path);
            if !path.is_absolute() { return Err(error("Library root must be an absolute path")); }
            path
        } else {
            self.dir.lock().unwrap().as_ref().ok_or_else(|| error("No collection open"))?.join("Library")
        };
        if fs::symlink_metadata(&root).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(error("Library root must not be a symlink"));
        }
        fs::create_dir_all(&root).map_err(error)?;
        root.canonicalize().map_err(error)
    }

    pub(crate) fn library_call(&self, method: &str, input: &[u8]) -> Result<Vec<u8>, CallError> {
        let root = self.library_root()?;
        if matches!(method, "klausLibraryList" | "klausLibraryFolder") {
            let request = generic::Json::decode(input).map_err(error)?;
            let request: Value = serde_json::from_slice(&request.json).map_err(error)?;
            let path = request["path"].as_str().ok_or_else(|| error("Library path is required"))?;
            let folder = resolve(&root, path)?;
            if !folder.is_dir() { return Err(error("Library path must be a folder")); }
            let output = if method == "klausLibraryFolder" {
                let child = name(request["name"].as_str().ok_or_else(|| error("Folder name is required"))?)?;
                fs::create_dir(folder.join(child)).map_err(error)?;
                json!({"path": relative(path)?.join(child).to_string_lossy()})
            } else {
                let mut entries = vec![];
                for entry in fs::read_dir(folder).map_err(error)? {
                    let entry = entry.map_err(error)?;
                    let kind = entry.file_type().map_err(error)?;
                    if kind.is_symlink() || !(kind.is_dir() || kind.is_file() && pdf(&entry.path())) { continue; }
                    let metadata = entry.metadata().map_err(error)?;
                    let entry_name = entry.file_name().to_string_lossy().into_owned();
                    entries.push(json!({
                        "path": relative(path)?.join(&entry_name).to_string_lossy(),
                        "name": entry_name, "kind": if kind.is_dir() {"folder"} else {"pdf"},
                        "size": metadata.len(),
                        "modified": metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|time| time.as_millis() as u64).unwrap_or(0)
                    }));
                }
                entries.sort_by_key(|entry| (entry["kind"] != "folder", entry["name"].as_str().unwrap().to_lowercase()));
                json!({"rootLabel": root.file_name().unwrap_or_default().to_string_lossy(), "path": path, "entries": entries})
            };
            return Ok(generic::Json { json: serde_json::to_vec(&output).map_err(error)? }.encode_to_vec());
        }
        let request = LibraryFile::decode(input).map_err(error)?;
        if method == "klausLibraryImport" {
            let filename = name(&request.name)?;
            if !pdf(Path::new(filename)) || !request.data.starts_with(b"%PDF-") {
                return Err(error("Import requires a PDF Document"));
            }
            if request.data.len() > MAX_PDF { return Err(error("Documents must be 128 MiB or smaller")); }
            let folder = resolve(&root, &request.path)?;
            if !folder.is_dir() { return Err(error("Library path must be a folder")); }
            import(&folder.join(filename), &request.data)?;
            return Ok(LibraryFile { path: relative(&request.path)?.join(filename).to_string_lossy().into_owned(), name: filename.into(), data: vec![] }.encode_to_vec());
        }
        let path = resolve(&root, &request.path)?;
        if !pdf(&path) || !path.is_file() { return Err(error("Select a PDF Document")); }
        let file = fs::File::open(&path).map_err(error)?;
        if file.metadata().map_err(error)?.len() > MAX_PDF as u64 { return Err(error("Documents must be 128 MiB or smaller")); }
        let mut file = file.take(MAX_PDF as u64 + 1);
        let mut data = vec![];
        file.read_to_end(&mut data).map_err(error)?;
        if data.len() > MAX_PDF { return Err(error("Documents must be 128 MiB or smaller")); }
        if !data.starts_with(b"%PDF-") { return Err(error("Invalid PDF Document")); }
        Ok(LibraryFile { path: request.path, name: path.file_name().unwrap().to_string_lossy().into_owned(), data }.encode_to_vec())
    }
}
