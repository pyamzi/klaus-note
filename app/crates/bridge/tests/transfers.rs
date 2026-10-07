//! Package/CSV transfers exercise real Anki collections in disposable directories.
use anki_proto::{cards, collection, config, generic, import_export, media, notes, notetypes, scheduler, search, stats};
use klaus_bridge::Bridge;
use prost::Message;

fn call<T: Message + Default>(bridge: &Bridge, method: &str, input: impl Message) -> T {
    T::decode(bridge.call(method, &input.encode_to_vec()).unwrap().as_slice()).unwrap()
}

fn temporary() -> (tempfile::TempDir, Bridge) {
    let dir = tempfile::tempdir().unwrap();
    let bridge = Bridge::new().unwrap();
    bridge.open_collection(dir.path()).unwrap();
    (dir, bridge)
}

fn add_reviewed_note(bridge: &Bridge) -> (notes::Note, cards::Card, stats::ReviewLogs) {
    let names: notetypes::NotetypeNames = call(bridge, "getNotetypeNames", generic::Empty {});
    let id = names.entries.iter().find(|entry| entry.name == "Basic").unwrap().id;
    let mut note: notes::Note = call(bridge, "newNote", notetypes::NotetypeId { ntid: id });
    note.fields = vec!["Loop of Henle <img src=diagram.svg>".into(), "Countercurrent multiplier".into()];
    let _: generic::String = call(bridge, "addMediaFile", media::AddMediaFileRequest {
        desired_name: "diagram.svg".into(), data: b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec(),
    });
    let added: notes::AddNoteResponse = call(bridge, "addNote", notes::AddNoteRequest { note: Some(note), deck_id: 1 });
    let queued: scheduler::QueuedCards = call(bridge, "getQueuedCards", scheduler::GetQueuedCardsRequest { fetch_limit: 1, intraday_learning_only: false });
    let top = &queued.cards[0];
    let states = top.states.as_ref().unwrap();
    let cid = top.card.as_ref().unwrap().id;
    let _: collection::OpChanges = call(bridge, "answerCard", scheduler::CardAnswer {
        card_id: cid, current_state: states.current.clone(), new_state: states.easy.clone(),
        rating: scheduler::card_answer::Rating::Easy as i32,
        answered_at_millis: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64,
        milliseconds_taken: 4000,
    });
    (
        call(bridge, "getNote", notes::NoteId { nid: added.note_id }),
        call(bridge, "getCard", cards::CardId { cid }),
        call(bridge, "getReviewLogs", cards::CardId { cid }),
    )
}

fn assert_roundtrip(bridge: &Bridge, note: &notes::Note, card: &cards::Card, logs: &stats::ReviewLogs) {
    let restored_note: notes::Note = call(bridge, "getNote", notes::NoteId { nid: note.id });
    assert_eq!(restored_note.fields, note.fields);
    assert_eq!(restored_note.guid, note.guid);
    let restored_card: cards::Card = call(bridge, "getCard", cards::CardId { cid: card.id });
    assert_eq!(restored_card.note_id, card.note_id);
    assert_eq!(restored_card.interval, card.interval);
    assert_eq!(restored_card.reps, card.reps);
    assert_eq!(restored_card.queue, card.queue);
    let restored_logs: stats::ReviewLogs = call(bridge, "getReviewLogs", cards::CardId { cid: card.id });
    assert!(!logs.entries.is_empty());
    assert_eq!(restored_logs, *logs);
    assert!(bridge.media_dir().unwrap().join("diagram.svg").exists());
}

#[test]
fn collection_export_reopens_and_import_preserves_cards_notes_history_and_media() {
    let (_source_dir, source) = temporary();
    let (note, card, logs) = add_reviewed_note(&source);
    let exports = tempfile::tempdir().unwrap();
    let package = exports.path().join("collection.colpkg");
    source.export_package(&package, "colpkg", None).unwrap();
    // Collection export closes Anki internally; the wrapper must reopen it.
    assert_roundtrip(&source, &note, &card, &logs);
    let (target_dir, target) = temporary();
    target.import_collection_package(&package).unwrap();
    assert_roundtrip(&target, &note, &card, &logs);
    assert!(target_dir.path().join("backups").exists());
}

#[test]
fn deck_export_roundtrip_preserves_scheduling_and_history() {
    let (_source_dir, source) = temporary();
    let (note, card, logs) = add_reviewed_note(&source);
    let exports = tempfile::tempdir().unwrap();
    let package = exports.path().join("deck.apkg");
    source.export_package(&package, "apkg", Some(1)).unwrap();
    let (_target_dir, target) = temporary();
    let _: import_export::ImportResponse = call(&target, "importAnkiPackage", import_export::ImportAnkiPackageRequest {
        package_path: package.to_string_lossy().into(),
        options: Some(import_export::ImportAnkiPackageOptions { with_scheduling: true, with_deck_configs: true, ..Default::default() }),
    });
    assert_roundtrip(&target, &note, &card, &logs);
}

#[test]
fn bad_collection_import_keeps_original_collection_open() {
    let (dir, bridge) = temporary();
    let (note, card, logs) = add_reviewed_note(&bridge);
    let exports = tempfile::tempdir().unwrap();
    let invalid = exports.path().join("broken.colpkg");
    std::fs::write(&invalid, b"not an Anki backup").unwrap();
    assert!(bridge.import_collection_package(&invalid).is_err());
    assert_roundtrip(&bridge, &note, &card, &logs);
    assert!(std::fs::read_dir(dir.path()).unwrap().all(|entry| {
        !entry.unwrap().file_name().to_string_lossy().starts_with(".klaus-restore-")
    }), "staging file must be removed after failed import");
}

#[test]
fn csv_import_uses_anki_metadata_and_mapping() {
    let (_dir, bridge) = temporary();
    let files = tempfile::tempdir().unwrap();
    let file = files.path().join("cards.csv");
    std::fs::write(&file, "Question,Answer\nRenal physiology,Countercurrent exchange\n").unwrap();
    let names: notetypes::NotetypeNames = call(&bridge, "getNotetypeNames", generic::Empty {});
    let id = names.entries.iter().find(|entry| entry.name == "Basic").unwrap().id;
    let metadata: import_export::CsvMetadata = call(&bridge, "getCsvMetadata", import_export::CsvMetadataRequest {
        path: file.to_string_lossy().into(), notetype_id: Some(id), deck_id: Some(1), ..Default::default()
    });
    let response: import_export::ImportResponse = call(&bridge, "importCsv", import_export::ImportCsvRequest {
        path: file.to_string_lossy().into(), metadata: Some(metadata),
    });
    assert_eq!(response.log.unwrap().new.len(), 2);
    let matches: search::SearchResponse = call(&bridge, "searchNotes", search::SearchRequest { search: "Renal".into(), ..Default::default() });
    assert_eq!(matches.ids.len(), 1);
}

#[test]
fn periodic_backups_obey_interval_and_restore_review_history() {
    let (dir, bridge) = temporary();
    let (note, card, logs) = add_reviewed_note(&bridge);
    let mut prefs: config::Preferences = call(&bridge, "getPreferences", generic::Empty {});
    prefs.backups.as_mut().unwrap().minimum_interval_mins = 60;
    let _: generic::Empty = call(&bridge, "setPreferences", prefs);
    assert!(bridge.auto_backup_tick().unwrap());
    assert!(!bridge.auto_backup_tick().unwrap(), "unchanged data should not create another backup");
    let _: collection::OpChangesWithCount = call(&bridge, "addNoteTags", anki_proto::tags::NoteIdsAndTagsRequest { note_ids: vec![note.id], tags: "after-backup".into() });
    assert!(!bridge.auto_backup_tick().unwrap(), "changed data must still respect the configured interval");
    let files: Vec<_> = std::fs::read_dir(dir.path().join("backups")).unwrap().map(|entry| entry.unwrap().path()).collect();
    assert_eq!(files.len(), 1);
    let (_restored_dir, restored) = temporary();
    restored.import_collection_package(&files[0]).unwrap();
    let restored_note: notes::Note = call(&restored, "getNote", notes::NoteId { nid: note.id });
    assert_eq!(restored_note.fields, note.fields);
    let restored_logs: stats::ReviewLogs = call(&restored, "getReviewLogs", cards::CardId { cid: card.id });
    assert_eq!(restored_logs, logs);
    assert!(!restored.media_dir().unwrap().join("diagram.svg").exists(), "automatic backups intentionally omit media");
}

#[test]
fn export_rejects_invalid_scope_without_overwriting_destination() {
    let (_dir, bridge) = temporary();
    let files = tempfile::tempdir().unwrap();
    let path = files.path().join("existing.colpkg");
    std::fs::write(&path, b"keep me").unwrap();
    assert!(bridge.export_package(&path, "colpkg", Some(1)).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"keep me");
}

#[test]
fn restores_selected_old_backup_even_when_safety_backup_prunes_it() {
    let (_source_dir, source) = temporary();
    let (note, card, logs) = add_reviewed_note(&source);
    let (target_dir, target) = temporary();
    let backups = target_dir.path().join("backups");
    std::fs::create_dir_all(&backups).unwrap();
    let selected = backups.join("backup-2000-01-01-00.00.00.colpkg");
    source.export_package(&selected, "colpkg", None).unwrap();
    let mut prefs: config::Preferences = call(&target, "getPreferences", generic::Empty {});
    let limits = prefs.backups.as_mut().unwrap();
    limits.daily = 0;
    limits.weekly = 0;
    limits.monthly = 0;
    let _: generic::Empty = call(&target, "setPreferences", prefs);
    target.import_collection_package(&selected).unwrap();
    assert!(!selected.exists(), "Anki retention must actually prune the selected old backup");
    assert_roundtrip(&target, &note, &card, &logs);
    assert!(std::fs::read_dir(target_dir.path()).unwrap().all(|entry| {
        !entry.unwrap().file_name().to_string_lossy().starts_with(".klaus-restore-")
    }), "staging file must be removed after import");
}
