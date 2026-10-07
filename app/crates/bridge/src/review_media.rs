//! Reviewer audio settings follow the card's original deck when filtered.
use crate::{Bridge, CallError};
use anki_proto::{cards, config, deck_config, decks, generic};

impl Bridge {
    pub(crate) fn review_audio_options(&self, card_id: i64) -> Result<(bool, bool, bool), CallError> {
        let card: cards::Card = self.rpc("getCard", cards::CardId { cid: card_id })?;
        let deck: decks::Deck = self.rpc("getDeck", decks::DeckId {
            did: if card.original_deck_id != 0 { card.original_deck_id } else { card.deck_id },
        })?;
        let config_id = match deck.kind {
            Some(decks::deck::Kind::Normal(normal)) => normal.config_id,
            _ => 1,
        };
        let preset: deck_config::DeckConfig = self.rpc("getDeckConfig", deck_config::DeckConfigId { dcid: config_id })?;
        let prefs: config::Preferences = self.rpc("getPreferences", generic::Empty {})?;
        let preset = preset.config.unwrap_or_default();
        Ok((!preset.disable_autoplay, !preset.skip_question_when_replaying_answer,
            prefs.reviewing.map(|p| p.interrupt_audio_when_answering).unwrap_or(true)))
    }
}
