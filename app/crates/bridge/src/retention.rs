//! Port of the add-on's browse_retention.py and retention.py. Shared by app
//! Browse and future Library scores; new cards intentionally return no estimate.
use anki_proto::{cards::{Card, CardId, CardIds}, generic, notes::NoteId, stats::CardStatsResponse};
use prost::Message;
use serde::Deserialize;
use serde_json::json;
use crate::{Bridge, CallError};

fn curve(stability: f64, decay: f64, elapsed: f64) -> f64 {
    let factor = 0.9_f64.powf(-1.0 / decay) - 1.0;
    (1.0 + factor * elapsed.max(0.0) / stability).powf(-decay).clamp(0.0, 1.0)
}
fn card_retention(card: &Card, now: f64, last_review: Option<i64>) -> Option<f64> {
    if card.ctype == 0 { return None; }
    if let Some(state) = card.memory_state.as_ref().filter(|s| s.stability > 0.0) {
        let elapsed = last_review.map(|time| (now - time as f64) / 86400.0).unwrap_or(0.0);
        let decay = card.decay.filter(|d| d.is_finite() && *d > 0.0).unwrap_or(0.5);
        return Some(curve(state.stability as f64, decay as f64, elapsed));
    }
    last_review.map(|time| curve(card.interval.max(1) as f64, 0.5, (now - time as f64) / 86400.0))
}
impl Bridge {
    pub(crate) fn browser_retention(&self, input: &[u8]) -> Result<Vec<u8>, CallError> {
        #[derive(Deserialize)]
        #[serde(rename_all="camelCase")]
        struct Request { ids: Vec<String>, notes_mode: bool }
        let bad = |e: String| CallError::Backend(e);
        let req = generic::Json::decode(input).map_err(|e| bad(e.to_string()))?;
        let req: Request = serde_json::from_slice(&req.json).map_err(|e| bad(e.to_string()))?;
        if req.ids.len() > 500 { return Err(bad("Retention requests support at most 500 rows".into())); }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64();
        let mut output = serde_json::Map::new();
        for text in req.ids {
            let id = text.parse::<i64>().map_err(|_| bad("Invalid row ID".into()))?;
            if id <= 0 { return Err(bad("Invalid row ID".into())); }
            let ids = if req.notes_mode { self.rpc::<_, CardIds>("cardsOfNote", NoteId { nid:id })?.cids } else { vec![id] };
            let mut weakest: Option<f64> = None;
            for cid in ids {
                let card: Card = self.rpc("getCard", CardId { cid })?;
                if card.ctype == 0 { continue; }
                let last = if card.last_review_time_secs.is_some() { card.last_review_time_secs }
                    else { self.rpc::<_, CardStatsResponse>("cardStats", CardId {cid})?.latest_review };
                if let Some(value) = card_retention(&card, now, last) { weakest = Some(weakest.map_or(value, |old| old.min(value))); }
            }
            output.insert(text, json!(weakest));
        }
        Ok(generic::Json { json: serde_json::to_vec(&output).unwrap() }.encode_to_vec())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_addon_retention_semantics() {
        let mut card = Card::default();
        assert_eq!(card_retention(&card, 864000.0, None), None);
        card.ctype = 2;
        assert_eq!(card_retention(&card, 864000.0, None), None);
        card.interval = 10;
        assert!((card_retention(&card, 864000.0, Some(0)).unwrap() - 0.9).abs() < 1e-6);
        card.memory_state = Some(anki_proto::cards::FsrsMemoryState { stability:10.0, difficulty:5.0 });
        card.decay = Some(0.2);
        assert!((card_retention(&card, 864000.0, Some(0)).unwrap() - 0.9).abs() < 1e-6);
        assert_eq!(card_retention(&card, 0.0, Some(864000)), Some(1.0));
    }
}
