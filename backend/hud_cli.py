"""
Run an interactive `hud` CLI command non-interactively.

`hud sync tasks` asks "Proceed?" via questionary/prompt_toolkit, which needs a
REAL terminal: a `DEVNULL` or pipe stdin makes prompt_toolkit call
`loop.add_reader(fd)` on a fd the OS selector can't register (`OSError [Errno 22]`
on macOS kqueue, `EPERM` on Linux epoll) and the command crashes before it can
upload. The deprecated `--yes` flag would skip the prompt, but instead we hand
the child a pseudo-terminal and pre-answer "y", so the plain
`hud sync tasks <name> <file>` command runs clean on any hud version.
"""

from __future__ import annotations

import os
import pty
import re
import select
import subprocess
import time

# A PTY makes `hud` think it's a terminal, so its output is full of ANSI colour /
# cursor codes. Strip them so callers can match on plain text and log readably.
_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


def strip_ansi(s: str) -> str:
    return _ANSI.sub("", s).replace("\r", "")


def sync_succeeded(output: str) -> bool:
    """True iff a `hud sync tasks` run actually uploaded (it exits 0 even when the
    upload raises, so the returncode can't be trusted — match the success line)."""
    clean = strip_ansi(output)
    return "Sync complete" in clean or "All tasks up to date" in clean


def run_sync(cmd: list[str], *, timeout: float = 240.0) -> tuple[int, str]:
    """Run `cmd` with a PTY stdin (auto-answering the confirm). Returns
    (returncode, combined stdout+stderr)."""
    master, slave = pty.openpty()
    try:
        proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
    except Exception:
        os.close(master)
        os.close(slave)
        raise
    os.close(slave)

    # Pre-answer the "Proceed?" confirmation. Re-sent a couple of times below in
    # case prompt_toolkit drains the buffer before its prompt is live. Harmless
    # if the command never asks.
    answered = 0

    def answer() -> None:
        nonlocal answered
        if answered < 3:
            try:
                os.write(master, b"y\n")
                answered += 1
            except OSError:
                pass

    answer()
    chunks: list[bytes] = []
    deadline = time.monotonic() + timeout
    while True:
        if time.monotonic() > deadline:
            proc.kill()
            break
        try:
            r, _, _ = select.select([master], [], [], 0.5)
        except OSError:
            break
        if r:
            try:
                data = os.read(master, 65536)
            except OSError:  # slave closed (child exited) → EIO on Linux
                break
            if not data:
                break
            chunks.append(data)
            # If the child is asking, nudge it again.
            if b"Proceed" in data or b"?" in data:
                answer()
        elif proc.poll() is not None:
            break

    try:
        os.close(master)
    except OSError:
        pass
    rc = proc.wait()
    return rc, strip_ansi(b"".join(chunks).decode("utf-8", "replace"))
