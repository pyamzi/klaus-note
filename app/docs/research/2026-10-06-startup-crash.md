# KlausNote startup abort, 2026-10-06

Status: fixed locally, tested, and installed at `/Applications/Klaus.app`. Changes are uncommitted.

The supplied report records `klaus` aborting about 0.65 seconds after launch through Rust panic handling and Tao's `did_finish_launching` callback. It does not include the original panic message. [Supplied report](</Users/pyamzi/.codex/attachments/23ffa126-9e7b-47bf-bee8-a06944eebad8/Pasted text.txt:6>).

A disposable Collection held open by the headless bridge reproduced SIGABRT in the native debug binary. The underlying error was `could not open Collection: Backend("Anki already open, or media currently syncing.")`. Tauri panicked on the returned setup error, which then aborted across the native launch callback. Historical logs also show another Klaus process active immediately before the reported crash. This supports a duplicate launch as the original trigger; the reproduction establishes the failure mechanism, rather than recovering the missing original panic message. [Reproduction](/tmp/klaus-startup-diagnosis-20261006/startup-red.txt), [process overlap](/tmp/klaus-startup-diagnosis-20261006/incident-process-overlap.txt).

## Fix

- Register Tauri's single-instance plugin first. A repeat launch exits before collection opening and asks the existing main window to show, unminimize, and focus. [Shell](/Users/pyamzi/Documents/Github/Klaus/klaus-note/app/src-tauri/src/main.rs:23), [official plugin guidance](https://v2.tauri.app/plugin/single-instance/).
- Open the Collection before running the native event loop. A collection-opening failure returns a normal error exit instead of reaching Tauri's panicking setup handler; it releases the instance socket. [Collection opening](/Users/pyamzi/Documents/Github/Klaus/klaus-note/app/src-tauri/src/main.rs:76).

## Verification

- The native regression uses a temporary Collection. Two locked startups exited with code 1, the expected collection error, no panic, and no retained instance socket. The actual plugin handed a repeat launch to a test Unix-socket receiver and exited with code 0 before collection access. [Test](/Users/pyamzi/Documents/Github/Klaus/klaus-note/app/tests/test_startup_lock.py), [results](/tmp/klaus-startup-diagnosis-20261006/startup-green.txt).
- `cargo build -p klaus`, `npm run install:local`, and diff whitespace checks passed. The installed bundle passed strict signature verification and exactly matched the built bundle. The installer preserved the previous bundle under `target/local-install-backups/previous.EZ638R/Klaus.app`. [Installation log](/tmp/klaus-startup-diagnosis-20261006/install.log).
- The installed release executable also passed the repeat-launch handoff check, exiting with code 0. Collection file size and modification timestamps remained unchanged during that check. [Installed verification](/tmp/klaus-startup-diagnosis-20261006/installed-check.json).

Normal window launch and foreground focus were not visually tested. Visible testing is restricted to Desktop 4, while the active desktop was Desktop 1; the regression checks exited before creating a window. This startup abort is separate evidence from the earlier reported idle Anki memory incident.
