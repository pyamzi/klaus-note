#!/bin/bash
# Refresh the existing Applications shortcut without opening a window or touching data.
set -euo pipefail
cd "$(dirname "$0")/.."

bundle="$PWD/target/release/bundle/macos/KlausNote.app"
destination="/Applications/Klaus.app"
if [[ ! -x "$bundle/Contents/MacOS/klaus" ]]; then
    echo "Build the app first with npm run install:local." >&2
    exit 1
fi
if pgrep -f '^/Applications/Klaus.app/Contents/MacOS/klaus([[:space:]]|$)' >/dev/null; then
    echo "Close KlausNote before installing so pending edits can finish saving." >&2
    exit 1
fi
# Local builds have no distribution signing identity. Seal the complete bundle.
codesign --force --deep --sign - "$bundle"

stage_dir=$(mktemp -d /Applications/.klaus-install.XXXXXX)
backup_dir=""
cleanup() {
    if [[ ! -e "$destination" && -n "$backup_dir" && -d "$backup_dir/Klaus.app" ]]; then
        mv "$backup_dir/Klaus.app" "$destination"
    fi
    rm -rf "$stage_dir"
}
trap cleanup EXIT

ditto "$bundle" "$stage_dir/Klaus.app"
codesign --verify --deep --strict "$stage_dir/Klaus.app"
diff -qr "$bundle" "$stage_dir/Klaus.app" >/dev/null
if [[ -e "$destination" ]]; then
    mkdir -p target/local-install-backups
    backup_dir=$(mktemp -d "$PWD/target/local-install-backups/previous.XXXXXX")
    mv "$destination" "$backup_dir/Klaus.app"
fi
mv "$stage_dir/Klaus.app" "$destination"
if ! codesign --verify --deep --strict "$destination"; then
    mv "$destination" "$stage_dir/failed.app"
    exit 1
fi
# Refresh Launch Services without launching or taking focus.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$destination"
printf 'Installed current build at %s\n' "$destination"
if [[ -n "$backup_dir" ]]; then printf 'Previous bundle saved at %s/Klaus.app\n' "$backup_dir"; fi
