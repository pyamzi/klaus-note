//! Reviewer behavior against a real scratch collection and the public bridge.
use anki_proto::{cards, collection, decks, generic, notes, notetypes, scheduler};
use klaus_bridge::Bridge;
use prost::Message;

fn call<T: Message + Default>(bridge: &Bridge, method: &str, input: impl Message) -> T {
    T::decode(bridge.call(method, &input.encode_to_vec()).unwrap().as_slice()).unwrap()
}
fn trusted<T: Message + Default>(bridge: &Bridge, method: &str, input: impl Message) -> T {
    T::decode(bridge.call_trusted(method, &input.encode_to_vec()).unwrap().as_slice()).unwrap()
}

#[test]
fn leech_action_follows_deck_options_and_is_undoable() {
    for suspend in [true, false] {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::new().unwrap();
        bridge.open_collection(dir.path()).unwrap();
        let config: generic::Json = trusted(&bridge, "getDeckConfigLegacy", anki_proto::deck_config::DeckConfigId { dcid: 1 });
        let mut config: serde_json::Value = serde_json::from_slice(&config.json).unwrap();
        config["lapse"]["leechFails"] = 1.into();
        config["lapse"]["leechAction"] = (if suspend { 0 } else { 1 }).into();
        let _: anki_proto::deck_config::DeckConfigId = trusted(&bridge, "addOrUpdateDeckConfigLegacy", generic::Json { json: serde_json::to_vec(&config).unwrap() });
        let types: notetypes::NotetypeNames = call(&bridge, "getNotetypeNames", generic::Empty {});
        let basic = types.entries.iter().find(|n| n.name == "Basic").unwrap();
        let mut note: notes::Note = call(&bridge, "newNote", notetypes::NotetypeId { ntid: basic.id });
        note.fields = vec!["Question".into(), "Answer".into()];
        let added: notes::AddNoteResponse = call(&bridge, "addNote", notes::AddNoteRequest { note: Some(note), deck_id: 1 });
        let ids: cards::CardIds = call(&bridge, "cardsOfNote", notes::NoteId { nid: added.note_id });
        let mut card: cards::Card = call(&bridge, "getCard", cards::CardId { cid: ids.cids[0] });
        card.ctype = 2; card.queue = 2; card.due = 0; card.interval = 10; card.ease_factor = 2500; card.reps = 1;
        let _: collection::OpChanges = trusted(&bridge, "updateCards", cards::UpdateCardsRequest { cards: vec![card.clone()], skip_undo_entry: false });
        let _: collection::OpChanges = call(&bridge, "setCurrentDeck", decks::DeckId { did: 1 });
        let queued: scheduler::QueuedCards = call(&bridge, "getQueuedCards", scheduler::GetQueuedCardsRequest { fetch_limit: 1, intraday_learning_only: false });
        let states = queued.cards[0].states.clone().unwrap();
        let _: collection::OpChanges = call(&bridge, "answerCard", scheduler::CardAnswer {
            card_id: card.id, current_state: states.current, new_state: states.again,
            rating: scheduler::card_answer::Rating::Again as i32,
            answered_at_millis: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64,
            milliseconds_taken: 1000,
        });
        let answered: cards::Card = call(&bridge, "getCard", cards::CardId { cid: card.id });
        let note: notes::Note = call(&bridge, "getNote", notes::NoteId { nid: added.note_id });
        assert_eq!(answered.queue == -1, suspend);
        assert_eq!(answered.lapses, 1);
        assert!(note.tags.iter().any(|tag| tag == "leech"));
        let _: collection::OpChangesAfterUndo = call(&bridge, "undo", generic::Empty {});
        let restored: cards::Card = call(&bridge, "getCard", cards::CardId { cid: card.id });
        let note: notes::Note = call(&bridge, "getNote", notes::NoteId { nid: added.note_id });
        assert_eq!(restored.queue, 2);
        assert_eq!(restored.lapses, 0);
        assert!(!note.tags.iter().any(|tag| tag == "leech"));
    }
}

#[test]
fn rendered_audio_includes_engine_tags_and_deck_preferences() {
    use klaus_bridge::klaus::{RenderCardRequest, RenderCardResponse};
    use anki_proto::card_rendering::av_tag::Value;
    let dir = tempfile::tempdir().unwrap();
    let bridge = Bridge::new().unwrap();
    bridge.open_collection(dir.path()).unwrap();
    let types: notetypes::NotetypeNames = call(&bridge, "getNotetypeNames", generic::Empty {});
    let basic = types.entries.iter().find(|n| n.name == "Basic").unwrap();
    let mut note: notes::Note = call(&bridge, "newNote", notetypes::NotetypeId { ntid: basic.id });
    note.fields = vec!["Question [sound:question clip.mp3]".into(), "Answer [sound:answer.mp3]".into()];
    let added: notes::AddNoteResponse = call(&bridge, "addNote", notes::AddNoteRequest { note: Some(note), deck_id: 1 });
    let ids: cards::CardIds = call(&bridge, "cardsOfNote", notes::NoteId { nid: added.note_id });
    let rendered: RenderCardResponse = call(&bridge, "klausRenderCard", RenderCardRequest { card_id: ids.cids[0], typed_answer: None });
    assert_eq!(rendered.question_av_tags[0].value, Some(Value::SoundOrVideo("question clip.mp3".into())));
    assert_eq!(rendered.answer_av_tags[0].value, Some(Value::SoundOrVideo("answer.mp3".into())));
    assert_eq!(rendered.answer_av_tags.len(), 1, "FrontSide should not duplicate question audio in answer autoplay");
    assert!(rendered.question.contains("play:q:0"));
    assert!(rendered.answer.contains("play:a:0"));
    assert!(rendered.autoplay);
    assert!(rendered.replay_question_audio);

    let config: generic::Json = trusted(&bridge, "getDeckConfigLegacy", anki_proto::deck_config::DeckConfigId { dcid: 1 });
    let mut config: serde_json::Value = serde_json::from_slice(&config.json).unwrap();
    config["autoplay"] = false.into();
    config["replayq"] = false.into();
    let _: anki_proto::deck_config::DeckConfigId = trusted(&bridge, "addOrUpdateDeckConfigLegacy", generic::Json { json: serde_json::to_vec(&config).unwrap() });
    let mut prefs: anki_proto::config::Preferences = call(&bridge, "getPreferences", generic::Empty {});
    prefs.reviewing.as_mut().unwrap().interrupt_audio_when_answering = false;
    let _: collection::OpChanges = call(&bridge, "setPreferences", prefs);
    let rendered: RenderCardResponse = call(&bridge, "klausRenderCard", RenderCardRequest { card_id: ids.cids[0], typed_answer: None });
    assert!(!rendered.autoplay);
    assert!(!rendered.replay_question_audio);
    assert!(!rendered.interrupt_audio);
    assert_eq!(rendered.question_av_tags.len(), 1, "manual replay remains available with autoplay disabled");
}
