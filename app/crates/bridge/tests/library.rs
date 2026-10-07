//! Library operations use real bridges and disposable collections/plain files.
use std::fs;

use anki_proto::generic;
use klaus_bridge::{Bridge, frontend::SetSettingJsonRequest, klaus::LibraryFile};
use prost::Message;
use serde_json::{json, Value};

const PDF: &[u8] = b"%PDF-1.7\nDocument fixture";

fn temporary() -> (tempfile::TempDir, Bridge) {
    let dir = tempfile::tempdir().unwrap();
    let bridge = Bridge::new().unwrap();
    bridge.open_collection(dir.path()).unwrap();
    (dir, bridge)
}

fn request(value: Value) -> Vec<u8> { generic::Json { json: serde_json::to_vec(&value).unwrap() }.encode_to_vec() }
fn listing(bridge: &Bridge, path: &str) -> Value {
    let result = bridge.call("klausLibraryList", &request(json!({"path":path}))).unwrap();
    serde_json::from_slice(&generic::Json::decode(result.as_slice()).unwrap().json).unwrap()
}
fn import(bridge: &Bridge, path: &str, name: &str, data: &[u8]) -> Result<Vec<u8>, klaus_bridge::CallError> {
    bridge.call("klausLibraryImport", &LibraryFile { path:path.into(), name:name.into(), data:data.to_vec() }.encode_to_vec())
}
fn read(bridge: &Bridge, path: &str) -> Result<Vec<u8>, klaus_bridge::CallError> {
    bridge.call("klausLibraryRead", &LibraryFile {path:path.into(), ..Default::default()}.encode_to_vec())
}

#[test]
fn import_folder_listing_read_and_restart_preserve_plain_documents() {
    let (dir, bridge) = temporary();
    let initial = listing(&bridge, "");
    assert_eq!(initial["rootLabel"], "Library");
    assert_eq!(initial["entries"], json!([]));
    bridge.call("klausLibraryFolder", &request(json!({"path":"","name":"Physiology"}))).unwrap();
    let output = import(&bridge, "Physiology", "Kidney.PDF", PDF).unwrap();
    let output = LibraryFile::decode(output.as_slice()).unwrap();
    assert_eq!(output.path, "Physiology/Kidney.PDF");
    assert!(output.data.is_empty());
    let folder = listing(&bridge, "Physiology");
    assert_eq!(folder["entries"][0]["name"], "Kidney.PDF");
    assert_eq!(folder["entries"][0]["kind"], "pdf");
    assert_eq!(folder["entries"][0]["size"], PDF.len());
    assert!(folder["entries"][0]["modified"].as_u64().unwrap() > 0);
    let stored = LibraryFile::decode(read(&bridge, &output.path).unwrap().as_slice()).unwrap();
    assert_eq!(stored.data, PDF);
    assert_eq!(fs::read(dir.path().join("Library/Physiology/Kidney.PDF")).unwrap(), PDF);
    assert!(!dir.path().join("lectures").exists());
    bridge.close_collection().unwrap();
    drop(bridge);
    let reopened = Bridge::new().unwrap();
    reopened.open_collection(dir.path()).unwrap();
    assert_eq!(listing(&reopened, "Physiology")["entries"], folder["entries"]);
    assert_eq!(LibraryFile::decode(read(&reopened, &output.path).unwrap().as_slice()).unwrap().data, PDF);
}

#[test]
fn listing_reflects_external_changes_and_orders_folders_before_documents() {
    let (dir, bridge) = temporary();
    listing(&bridge, "");
    let root = dir.path().join("Library");
    fs::write(root.join("B.pdf"), PDF).unwrap();
    fs::write(root.join("A.pdf"), PDF).unwrap();
    fs::write(root.join("ignored.txt"), b"text").unwrap();
    fs::create_dir(root.join("Z folder")).unwrap();
    let entries = listing(&bridge, "")["entries"].clone();
    assert_eq!(entries.as_array().unwrap().len(), 3);
    assert_eq!(entries[0]["name"], "Z folder");
    assert_eq!(entries[1]["name"], "A.pdf");
    fs::remove_file(root.join("A.pdf")).unwrap();
    assert_eq!(listing(&bridge, "")["entries"].as_array().unwrap().len(), 2);
}

#[test]
fn collisions_and_invalid_imports_do_not_modify_existing_materials() {
    let (dir, bridge) = temporary();
    import(&bridge, "", "Keep.pdf", PDF).unwrap();
    assert!(import(&bridge, "", "Keep.pdf", b"%PDF-replacement").is_err());
    assert_eq!(fs::read(dir.path().join("Library/Keep.pdf")).unwrap(), PDF);
    for (name, data) in [("wrong.txt", PDF), ("broken.pdf", b"not PDF".as_slice()), ("../escape.pdf", PDF), ("", PDF), ("/escape.pdf", PDF)] {
        assert!(import(&bridge, "", name, data).is_err(), "{name}");
    }
    let folder = request(json!({"path":"","name":"Folder"}));
    bridge.call("klausLibraryFolder", &folder).unwrap();
    assert!(bridge.call("klausLibraryFolder", &folder).is_err());
    assert_eq!(listing(&bridge, "")["entries"].as_array().unwrap().len(), 2);
    assert!(!fs::read_dir(dir.path().join("Library")).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with(".klaus-import")));
}

#[test]
fn traversal_and_non_document_reads_are_rejected() {
    let (dir, bridge) = temporary();
    listing(&bridge, "");
    fs::write(dir.path().join("Library/private.txt"), b"private").unwrap();
    fs::write(dir.path().join("Library/broken.pdf"), b"private").unwrap();
    for path in ["../collection.anki2", "..", "/tmp/outside", "./private.txt", "folder/../../private.txt", "folder\\private.pdf"] {
        assert!(read(&bridge, path).is_err(), "{path}");
        assert!(bridge.call("klausLibraryList", &request(json!({"path":path}))).is_err(), "{path}");
        assert!(import(&bridge, path, "Escape.pdf", PDF).is_err(), "{path}");
    }
    for path in ["private.txt", "broken.pdf", ""] { assert!(read(&bridge, path).is_err(), "{path}"); }
    for child in ["..", "../escape", "a/b", "/tmp/escape", ""] {
        assert!(bridge.call("klausLibraryFolder", &request(json!({"path":"","name":child}))).is_err());
    }
}

#[cfg(unix)]
#[test]
fn symlink_roots_files_and_folders_cannot_escape_library() {
    use std::os::unix::fs::symlink;
    let (dir, bridge) = temporary();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("secret.pdf"), PDF).unwrap();
    symlink(outside.path(), dir.path().join("Library")).unwrap();
    assert!(bridge.call("klausLibraryList", &request(json!({"path":""}))).is_err());
    fs::remove_file(dir.path().join("Library")).unwrap();
    listing(&bridge, "");
    symlink(outside.path(), dir.path().join("Library/link")).unwrap();
    symlink(outside.path().join("secret.pdf"), dir.path().join("Library/secret.pdf")).unwrap();
    assert_eq!(listing(&bridge, "")["entries"], json!([]));
    assert!(read(&bridge, "secret.pdf").is_err());
    assert!(read(&bridge, "link/secret.pdf").is_err());
    assert!(import(&bridge, "link", "new.pdf", PDF).is_err());
    assert!(bridge.call("klausLibraryFolder", &request(json!({"path":"link","name":"New"}))).is_err());
    assert!(!outside.path().join("new.pdf").exists());
}

#[test]
fn configured_library_root_is_respected_and_relative_roots_rejected() {
    let (_dir, bridge) = temporary();
    let materials = tempfile::tempdir().unwrap();
    let set = |value: Value| bridge.call("setProfileConfigJson", &SetSettingJsonRequest {key:"libraryRoot".into(), value_json:serde_json::to_vec(&value).unwrap()}.encode_to_vec()).unwrap();
    set(json!(materials.path().to_string_lossy()));
    import(&bridge, "", "External.pdf", PDF).unwrap();
    assert_eq!(fs::read(materials.path().join("External.pdf")).unwrap(), PDF);
    set(json!("relative/folder"));
    assert!(bridge.call("klausLibraryList", &request(json!({"path":""}))).is_err());
}

#[test]
fn oversized_external_document_is_rejected() {
    let (dir, bridge) = temporary();
    listing(&bridge, "");
    let mut file = fs::File::create(dir.path().join("Library/large.pdf")).unwrap();
    std::io::Write::write_all(&mut file, PDF).unwrap();
    file.set_len(128 * 1024 * 1024 + 1).unwrap();
    assert!(read(&bridge, "large.pdf").is_err());
}
