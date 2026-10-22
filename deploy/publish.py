#!/usr/bin/env python3
"""Test and explicitly publish allowlisted committed source over an existing SSH connection."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

from server import REQUIRED, allowed_source, commit_id


ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = "/usr/local/sbin/asteroid-explorer-deploy"


def check_host(host: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.@-]*", host):
        raise ValueError("Use an SSH config alias or user@hostname without shell characters.")
    return host


def check_upload_path(path: str) -> str:
    if not re.fullmatch(r"/srv/asteroid-explorer/incoming/upload-[A-Za-z0-9]+\.tar", path):
        raise ValueError("Server returned an unexpected temporary upload path.")
    return path


def run(*args: str, capture: bool = False) -> str:
    command = [shutil.which(args[0]) or args[0], *args[1:]]
    result = subprocess.run(command, cwd=ROOT, check=True, text=True, capture_output=capture)
    return result.stdout.strip() if capture else ""


def clean_commit() -> str:
    if run("git", "status", "--porcelain", capture=True):
        raise ValueError("Commit or remove pending changes before publishing; only HEAD is deployed.")
    return commit_id(run("git", "rev-parse", "HEAD", capture=True))


def source_paths(commit: str) -> list[str]:
    result = subprocess.run(["git", "ls-tree", "-rz", "--full-tree", commit],
                            cwd=ROOT, check=True, capture_output=True)
    selected = []
    for entry in result.stdout.split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        name = raw_name.decode("utf-8")
        if allowed_source(name):
            if metadata.split()[0] not in {b"100644", b"100755"}:
                raise ValueError("Application release cannot contain symbolic links or submodules.")
            selected.append(name)
    if not REQUIRED.issubset(selected):
        raise ValueError("Committed source is missing required application files.")
    return selected


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", required=True, help="Existing SSH alias or user@hostname; never stored in Git")
    parser.add_argument("--as-root", action="store_true", help="SSH already logs in as root; omit sudo")
    args = parser.parse_args()
    remote_path = None
    try:
        host = check_host(args.host)
        commit = clean_commit()
        run("npm", "test")
        run(sys.executable, "-m", "unittest", "discover", "-s", "deploy", "-p", "test_*.py", "-v")
        if clean_commit() != commit:
            raise ValueError("Checkout changed during verification; run publish again.")
        paths = source_paths(commit)
        with tempfile.TemporaryDirectory(prefix="asteroid-publish-") as directory:
            bundle = Path(directory) / "release.tar"
            run("git", "archive", "--format=tar", "--output", str(bundle), commit, "--", *paths)
            checksum = hashlib.sha256(bundle.read_bytes()).hexdigest()
            remote_path = check_upload_path(run("ssh", "-o", "BatchMode=yes", host,
                "mktemp /srv/asteroid-explorer/incoming/upload-XXXXXXXXXX.tar", capture=True))
            run("scp", "-o", "BatchMode=yes", str(bundle), f"{host}:{remote_path}")
            command = [CONTROLLER, remote_path, commit, checksum]
            if not args.as_root:
                command = ["sudo", "-n", *command]
            run("ssh", "-o", "BatchMode=yes", host, shlex.join(command))
        print(f"Deployed committed release {commit}.")
        return 0
    except (ValueError, OSError, UnicodeError, subprocess.CalledProcessError) as error:
        print(f"Deployment failed: {error}", file=sys.stderr)
        return 1
    finally:
        if remote_path:
            try:
                result = subprocess.run(["ssh", "-o", "BatchMode=yes", host,
                                         shlex.join(["rm", "-f", "--", remote_path])])
                removed = result.returncode == 0
            except OSError:
                removed = False
            if not removed:
                print(f"Remove the temporary upload on {host}: {remote_path}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
