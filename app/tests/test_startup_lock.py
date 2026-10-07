"""macOS startup regression using a locked disposable Collection, no windows.

Build first: cargo build -p klaus -p klaus-bridge --example headless
Run: python3 tests/test_startup_lock.py
The native debug binary must also be built with cargo build -p klaus.
"""
from __future__ import annotations

import os
from pathlib import Path
import select
import socket
import subprocess
import sys
import tempfile


def main() -> None:
    if sys.platform != "darwin":
        raise SystemExit("This native startup regression requires macOS")
    root = Path(__file__).resolve().parents[1]
    binary = root / "target/debug/klaus"
    server = root / "target/debug/examples/headless"
    ipc = Path("/tmp/ink_klaus_desktop_si.sock")
    if ipc.exists():
        raise SystemExit("Close KlausNote before this test; its instance socket already exists")
    with tempfile.TemporaryDirectory(prefix="klaus-startup-test-") as tmp:
        env = dict(os.environ, KLAUS_DATA_DIR=tmp)
        holder = subprocess.Popen([str(server), tmp], cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            assert select.select([holder.stdout], [], [], 10)[0], "Collection holder did not start"
            assert holder.stdout.readline().startswith(b"KlausNote dev URL:"), "Collection holder failed"
            # A locked Collection must produce a regular error exit, never SIGABRT.
            for _ in range(2):
                result = subprocess.run([str(binary)], cwd=root, env=env, capture_output=True, timeout=10)
                assert result.returncode == 1, f"Startup exit was {result.returncode}"
                assert b"could not open Collection" in result.stderr, result.stderr
                assert b"Anki already open" in result.stderr, result.stderr
                assert b"panicked" not in result.stderr, result.stderr
                assert not ipc.exists(), "Failed startup retained its instance socket"
            print("PASS: locked Collection exits cleanly twice without a panic")
            # Exercise the actual plugin handoff before any Collection open.
            with socket.socket(socket.AF_UNIX) as listener:
                listener.bind(str(ipc))
                listener.listen(1)
                listener.settimeout(5)
                result = subprocess.run([str(binary)], cwd=root, env=env, capture_output=True, timeout=10)
                assert result.returncode == 0, f"Repeat launch exit was {result.returncode}"
                connection, _ = listener.accept()
                with connection:
                    payload = connection.recv(4096)
                assert b"\0\0" in payload and str(binary).encode() in payload, payload
                assert b"could not open Collection" not in result.stderr, result.stderr
            print("PASS: repeat launch forwards to the existing instance before opening the Collection")
        finally:
            holder.terminate()
            try:
                holder.wait(timeout=5)
            except subprocess.TimeoutExpired:
                holder.kill()
                holder.wait()
            ipc.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
