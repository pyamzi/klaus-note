# KlausBook

A Tauri rewrite of Anki: spaced-repetition flashcards (priority), a PDF annotator with lecture recorder, and a Markdown/LaTeX editor. Reference apps live in `references/` (gitignored): leed_pdf_viewer, openwhispr, siyuan, zed.

## Reference and delivery order

User direction (2026-10-06): build the app's Anki foundation first, then layer KlausNote for Anki features on top. [Upstream Anki](https://github.com/ankitects/anki) is the primary behavior and implementation reference; the add-on is the reference for Klaus-specific extensions.

1. Before implementing a feature, inspect the relevant code in the pinned `vendor/anki` checkout: backend and protocol, TypeScript editor/reviewer/pages, and Python/Qt host logic where it defines behavior. Reuse Anki's existing engine and contracts through the app's bridge. See [ADR-0001](docs/adr/0001-build-on-anki-rslib.md) and [ADR-0006](docs/adr/0006-ui-talks-only-to-the-bridge.md).
2. Implement and verify the affected Anki workflow first: Collection operations, decks, Study/scheduling, Note editing, Browser/search, media, undo, import/export, preferences, or sync. A served page or working layout alone does not establish behavior parity. Check persisted data and failure handling using scratch collections.
3. Then add the corresponding KlausNote for Anki workspace, PDF/Library, retention, OCR, model, or other extension behavior, with regression checks for the Anki foundation underneath. Adapt extensions to the app's stack, following [ADR-0004](docs/adr/0004-no-python-addons.md).

Delivery checklist: [add-on parity plan](docs/research/addon-app-parity.md). Close relevant core behavior gaps before prioritizing add-on enhancements.

## Develop

Anki is a pinned git submodule at `vendor/anki` (ADR-0001); its crates are path dependencies. Prerequisites: Rust (toolchain pinned in `rust-toolchain.toml`), Node 22, `protoc` (`brew install protobuf`).

```sh
git submodule update --init
git -C vendor/anki submodule update --init --depth 1 ftl/core-repo ftl/qt-repo
npm install
npm run tauri dev               # build frontend + run the app
cargo test -p klaus-bridge      # the one automated seam
npm run check                   # typecheck the frontend
npm run install:local           # build and refresh /Applications/Klaus.app
```

- `crates/bridge`: the Backend Bridge. Serves the frontend and Anki's `/_anki/<method>` contract from 127.0.0.1; only methods in its allowlist are callable from the webview.
- Local delivery preference (2026-10-06): after finishing and verifying KlausNote app updates, refresh the existing `/Applications/Klaus.app` with `npm run install:local`. Keep this stable path so the user's Applications/Dock shortcut opens the current local build. The installer preserves a previous bundle in `target/local-install-backups`, leaves collection data untouched, and does not launch a window. Visible testing must stay on Desktop 4; use headless checks until placement there is verified.
- `src-tauri`: the Tauri shell. Opens the Collection in the app data dir and points the window at the bridge.
- `src/`: SvelteKit frontend (assets under `/_klaus`). `@generated` is Anki's TS library, generated into `vendor/anki/out/ts/lib/generated` by `npm run gen`.
- Anki's own pages (import, deck options, graphs, …) are built from `vendor/anki/ts` by `scripts/build-anki-pages.sh` (Anki's pinned yarn; skipped when already built for the current Anki commit) and served by the bridge at their Anki routes plus `/_app`. Requests those pages make to their Qt host go to the shell as hooks (native dialogs, navigation) or are answered by the bridge (profile settings in `klaus-settings.json` beside the Collection, pasted-image conversion). `static/anki-host.js` stands in for Qt's `bridgeCommand`/`pycmd` and is injected, with `anki-host.css`, into every Anki page; media files are served at the page-relative URLs Anki pages use. Tauri's macOS webview has no `alert()`/`confirm()` UI, so `static/native-dialogs.js` (loaded first on KlausNote's and Anki's pages) routes them to the shell's `showMessageBox`/`askUser` with a synchronous request; KlausNote's own screens use in-page `<dialog>`s for input instead of `prompt()`. Deck options' save (`updateDeckConfigs`) returns at once and runs in the background, as in Anki, then fires `deckOptionsRequireClose` (or `showMessageBox` on failure).
- Debug builds print a `KlausNote dev URL` with the session token, so a browser can drive the same pages. `KLAUS_DATA_DIR=<dir>` (a scratch Collection) and `KLAUS_OPEN=<page>` (e.g. `review?deck=1`) are honoured in debug builds only.
  Change notetype takes its note selection from the page URL, as Qt's dialog would supply it: `KLAUS_OPEN="change-notetype/<old notetype ID>?nid=<note ID>"`, repeating `nid` for each note (all of the old note type); saves without a selection are rejected.
- Review (`src/routes/review`): KlausNote's screen owns queue, grading and undo; cards render in a sandboxed (opaque-origin) frame, `static/card.html` + `static/card-host.js`, running Anki's reviewer JS from `/_anki/js` (built into `vendor/anki/out/klaus` by `build-anki-pages.sh`). The frame can't reach `/_anki`, only `postMessage` the review screen, which accepts a fixed command set. Card HTML is assembled by the bridge's `klausRenderCard` (`crates/bridge/proto/klaus.proto`).
- Browser (`src/routes/browse`): Anki's Qt browser rebuilt on the backend's browser rows (`searchCards`/`searchNotes`, `browserRowForId` for the columns set by `setActiveBrowserColumns`, Anki's config keys for columns, sort and notes mode). The side editor is Anki's editor page in `mode=browser`, framed by the browser (only the editor's CSP allows same-origin framing); embedded, `anki-host.js` forwards its bridge commands and an `updateNotes` completion (`noteUpdated`, by watching `fetch` for `/_anki/updateNotes`: recheck on Anki upgrades) to the page. Preview reuses the review card frame (`src/lib/card.ts`).
- The UI reaches the Collection and host only through `/_anki` (ADR-0006), so app.klaus.ink can later serve it against a server bridge: no Tauri API calls in Svelte.
- Domains and sign-in (ADR-0008): klaus.ink is retired for klaus.so; the Klaus account is a shared OIDC provider at app.klaus.so, and KlausNote's server exchanges its sign-in for the sync key. The klaus.ink names below predate it.
- Sync (ADR-0007, contract in `docs/klaus-ink-sync.md`): the Collection syncs with klaus.ink under the Klaus account, on Anki's sync protocol. Sign-in is OAuth with PKCE in the system browser (`klausAccountSignIn` returns the URL; klaus.ink redirects to the bridge's `/auth/callback`, which exchanges the code); the token is the sync key, held in a `Secrets` store (the macOS Keychain via `keyring` in the shell, memory in tests) so the page never sees it. Sync is automatic (`crates/bridge/src/sync.rs`; sign-in in `account.rs`), under one rule, `should_auto_sync` = signed in and `autoSync` on, as Anki's `can_auto_sync`: on open (`sync_in_background`), on quit (the shell holds the exit), and every minute when Anki's `syncStatus` says there's something to sync and the page has been quiet for 30 s (`auto_sync_tick`). All syncs report through `klausSyncOutcome`, which `src/routes/SyncControl.svelte` polls; a full sync waits there for the user's choice, and a full download backs up to `<data dir>/backups` first. `KLAUS_ACCOUNT_URL` points the app at another klaus.ink. Tests run a fake klaus.ink and rslib's sync server inside the test binary.
- UI: [shadcn-svelte](https://shadcn-svelte.com) on Tailwind v4 (`components.json`; components in `src/lib/components/ui`, added with `npx shadcn-svelte@latest add <name>`). Theme tokens live in `src/app.css`, generated from the Klaus design system's `tokens.json` (the ground truth for every design choice; see `shared-context/CONTEXT.md`): the shadcn-svelte preset `b2GUtMueeu` (Nova, Zinc, near-black primary, Inter + DM Sans, Tabler icons, bold menu accent) with Anki's count and browser-row colours, and dark mode following the system (`prefers-color-scheme`, no `.dark` class, so the shadcn CLI's `.dark` block is never used). Icons: `@tabler/icons-svelte`, imported as `import { IconX } from "@tabler/icons-svelte"`. The `shadcn-svelte` agent skill is in `.claude/skills`. Anki's own pages keep Anki's styling.
- Logo: `static/klaus-logo.svg` is the brand master (also the favicon). `src-tauri/icons/icon.svg` is the white k on the Klaus-blue tile, placed on the macOS icon grid (klaus.ink uses the bare blue k instead); regenerate the icon set with `npx tauri icon src-tauri/icons/icon.svg -o src-tauri/icons`.
- Upgrading Anki: check out a new release tag in `vendor/anki`, re-copy its `rust-toolchain.toml`, match the `typescript` and `@bufbuild/*` versions in `package.json` to `vendor/anki/yarn.lock` (Anki's `post.ts` must type-check unmodified), and run the tests.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `pyamzi/klaus-note` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
