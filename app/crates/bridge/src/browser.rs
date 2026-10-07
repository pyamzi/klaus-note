//! Browser-only operations that Anki implements in its Python collection wrapper.
use std::collections::{BTreeMap, HashMap};

use anki_proto::{generic, notes::{Note, NoteId}, notetypes::{Notetype, NotetypeId}};
use prost::Message;
use serde::Deserialize;
use serde_json::json;

use crate::{Bridge, CallError};

impl Bridge {
    pub(crate) fn find_duplicates(&self, input: &[u8]) -> Result<Vec<u8>, CallError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request { note_ids: Vec<String>, field_name: String }
        let bad = |e: String| CallError::Backend(e);
        let envelope = generic::Json::decode(input).map_err(|e| bad(e.to_string()))?;
        let request: Request = serde_json::from_slice(&envelope.json).map_err(|e| bad(e.to_string()))?;
        if request.field_name.trim().is_empty() {
            return Err(bad("Choose a field to check for duplicates".into()));
        }
        let mut ids = request.note_ids.iter().map(|id| id.parse::<i64>())
            .collect::<Result<Vec<_>, _>>().map_err(|_| bad("Invalid note ID".into()))?;
        if ids.iter().any(|id| *id <= 0) { return Err(bad("Invalid note ID".into())); }
        ids.sort_unstable();
        ids.dedup();
        let mut fields: HashMap<i64, Option<usize>> = HashMap::new();
        let mut values: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for nid in ids {
            let note: Note = self.rpc("getNote", NoteId { nid })?;
            let ordinal = if let Some(ordinal) = fields.get(&note.notetype_id) { *ordinal } else {
                let notetype: Notetype = self.rpc("getNotetype", NotetypeId { ntid: note.notetype_id })?;
                let ordinal = notetype.fields.iter().position(|field| field.name.to_lowercase() == request.field_name.to_lowercase());
                fields.insert(note.notetype_id, ordinal);
                ordinal
            };
            if let Some(value) = ordinal.and_then(|index| note.fields.get(index)) {
                // Same engine helper as Python's strip_html_media(): retain media filenames.
                let value = anki::text::strip_html_preserving_media_filenames(value).into_owned();
                if !value.is_empty() { values.entry(value).or_default().push(nid.to_string()); }
            }
        }
        let groups: Vec<_> = values.into_iter().filter(|(_, ids)| ids.len() > 1)
            .map(|(text, note_ids)| json!({"text":text, "noteIds":note_ids})).collect();
        Ok(generic::Json { json: serde_json::to_vec(&json!({"groups":groups})).unwrap() }.encode_to_vec())
    }
}
