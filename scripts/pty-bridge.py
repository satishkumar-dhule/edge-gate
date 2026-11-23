#!/usr/bin/env python3
"""
Full Linux Kernel PTY/TTY Bridge for VS Code Integrated Compute Terminal.
Allocates a real /dev/pts/N pseudo-terminal via pty.openpty() + os.fork() +
setsid() + TIOCSCTTY + TIOCSWINSZ so interactive shells and TUI programs
(bash -i, vim, nano, top, less, python3/node REPLs, tab completion, Ctrl+C/D/Z)
work natively over JSON-framed stdio.
"""

import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_winsize(fd: int, rows: int, cols: int) -> None:
    rows = max(5, min(200, int(rows)))
    cols = max(20, min(400, int(cols)))
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


def emit(obj: dict) -> None:
    try:
        sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        pass


def main() -> int:
    shell = os.environ.get("COMPUTE_PTY_SHELL", "/bin/bash")
    cwd = os.environ.get("COMPUTE_PTY_CWD", os.getcwd())
    cols = int(os.environ.get("COMPUTE_PTY_COLS", "120"))
    rows = int(os.environ.get("COMPUTE_PTY_ROWS", "30"))

    if not os.path.isdir(cwd):
        cwd = os.getcwd()

    master_fd, slave_fd = pty.openpty()
    tty_name = os.ttyname(slave_fd)
    set_winsize(master_fd, rows, cols)

    pid = os.fork()
    if pid == 0:
        # Child process: attach to real slave TTY as session leader
        os.close(master_fd)
        os.setsid()
        try:
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        except OSError:
            pass

        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)

        os.chdir(cwd)
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["FORCE_COLOR"] = "1"
        env["COLUMNS"] = str(cols)
        env["LINES"] = str(rows)
        env["PS1"] = r"\[\e[1;32m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ "

        shell_args = [shell, "-i"] if os.path.basename(shell) in ("bash", "zsh", "sh") else [shell]
        os.execvpe(shell, shell_args, env)
        os._exit(127)

    # Parent bridge process
    os.close(slave_fd)
    set_winsize(master_fd, rows, cols)

    # Make master_fd and stdin non-blocking for multiplexed I/O
    os.set_blocking(master_fd, False)
    stdin_fd = sys.stdin.fileno()
    os.set_blocking(stdin_fd, False)

    emit({"type": "ready", "pid": pid, "tty": tty_name, "cwd": cwd, "cols": cols, "rows": rows})

    stdin_buffer = b""
    exit_code = 0
    child_alive = True

    def reap_child() -> None:
        nonlocal child_alive, exit_code
        if not child_alive:
            return
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                child_alive = False
                if os.WIFEXITED(status):
                    exit_code = os.WEXITSTATUS(status)
                elif os.WIFSIGNALED(status):
                    exit_code = 128 + os.WTERMSIG(status)
        except ChildProcessError:
            child_alive = False

    def kill_group(sig: int) -> None:
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            pass
        except OSError:
            try:
                os.kill(pid, sig)
            except OSError:
                pass

    try:
        while True:
            reap_child()
            read_fds = [master_fd]
            if stdin_fd is not None:
                read_fds.append(stdin_fd)

            try:
                rlist, _, _ = select.select(read_fds, [], [], 0.1)
            except (InterruptedError, ValueError):
                rlist = []

            if master_fd in rlist:
                try:
                    chunk = os.read(master_fd, 16384)
                    if not chunk:
                        break
                    emit({"type": "data", "b64": base64.b64encode(chunk).decode("ascii")})
                except BlockingIOError:
                    pass
                except OSError:
                    # EIO on Linux when slave side closes
                    break

            if stdin_fd is not None and stdin_fd in rlist:
                try:
                    raw = os.read(stdin_fd, 16384)
                    if not raw:
                        # Node parent closed bridge stdin -> terminate child cleanly
                        kill_group(signal.SIGTERM)
                        stdin_fd = None
                    else:
                        stdin_buffer += raw
                        while b"\n" in stdin_buffer:
                            line, stdin_buffer = stdin_buffer.split(b"\n", 1)
                            line_str = line.decode("utf-8", errors="ignore").strip()
                            if not line_str:
                                continue
                            try:
                                msg = json.loads(line_str)
                            except json.JSONDecodeError:
                                continue
                            mtype = msg.get("type")
                            if mtype == "input":
                                b64 = msg.get("b64", "")
                                if isinstance(b64, str) and b64:
                                    payload = base64.b64decode(b64)
                                    os.write(master_fd, payload)
                            elif mtype == "resize":
                                c = int(msg.get("cols", cols))
                                r = int(msg.get("rows", rows))
                                set_winsize(master_fd, r, c)
                                kill_group(signal.SIGWINCH)
                            elif mtype == "signal":
                                sig_name = str(msg.get("sig", "SIGINT")).upper()
                                sig_map = {
                                    "SIGINT": signal.SIGINT,
                                    "SIGTERM": signal.SIGTERM,
                                    "SIGKILL": signal.SIGKILL,
                                    "SIGHUP": signal.SIGHUP,
                                }
                                kill_group(sig_map.get(sig_name, signal.SIGINT))
                except BlockingIOError:
                    pass
                except OSError:
                    stdin_fd = None

            if not child_alive:
                # Drain any remaining bytes from master_fd before exiting
                try:
                    while True:
                        chunk = os.read(master_fd, 16384)
                        if not chunk:
                            break
                        emit({"type": "data", "b64": base64.b64encode(chunk).decode("ascii")})
                except OSError:
                    pass
                break
    finally:
        if child_alive:
            kill_group(signal.SIGTERM)
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
        try:
            os.close(master_fd)
        except OSError:
            pass
        emit({"type": "exit", "code": exit_code})

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
