#!/usr/bin/env python3
"""Reviewed root-installed deployment controller; uploaded source is never host code."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request


ROOT = Path("/srv/asteroid-explorer")
RELEASES = ROOT / "releases"
INCOMING = ROOT / "incoming"
CONFIG = Path("/etc/asteroid-explorer")
COMPOSE = CONFIG / "compose.yaml"
ENVIRONMENT = CONFIG / "environment"
DOCKERFILE = CONFIG / "Dockerfile"
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_MEMBERS = 1000
REQUIRED = {"package.json", "package-lock.json", "server.mjs", "index.html",
            "lib/jpl-api.mjs", "src/js/app.js", "data/main-belt-startup.json",
            "config/startup-sample-core-bodies.json"}


def commit_id(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Release must be a complete Git commit SHA.")
    return value


def digest_id(value: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("Supply the complete SHA256 archive checksum.")
    return value


def image_name(commit: str) -> str:
    return f"asteroid-explorer:{commit_id(commit)}"


def allowed_source(name: str) -> bool:
    """The image receives application source/data only, never deployment or secret files."""
    path = PurePosixPath(name)
    if (not re.fullmatch(r"[A-Za-z0-9_./-]+", name) or path.is_absolute()
            or name != path.as_posix() or any(p.startswith(".") for p in path.parts)):
        return False
    if name in {"package.json", "package-lock.json", "server.mjs", "index.html",
                "data/main-belt-startup.json", "config/startup-sample-core-bodies.json"}:
        return True
    return (len(path.parts) > 1 and (
        path.parts[0] == "lib" and path.suffix == ".mjs"
        or path.parts[0] == "src" and path.suffix in {
            ".js", ".css", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2"
        }
    ))


def run(*args: str, capture: bool = False, env: dict | None = None) -> str:
    result = subprocess.run(args, check=True, text=True, capture_output=capture, env=env)
    return result.stdout.strip() if capture else ""


def check_installed_file(path: Path) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError(f"{path} must be a root-owned regular file without group/world write access.")


def check_directory(path: Path) -> None:
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError(f"{path} must be a root-owned directory without group/world write access.")


def validate_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    if len(members) > MAX_MEMBERS or sum(m.size for m in members) > MAX_BUNDLE_BYTES:
        raise ValueError("Release archive exceeds the member or expanded-size limit.")
    selected = []
    seen = set()
    for member in members:
        name = member.name.rstrip("/") if member.isdir() else member.name
        path = PurePosixPath(name)
        if (not name or name != path.as_posix() or "\\" in name or path.is_absolute()
                or any(p.startswith(".") for p in path.parts) or not (member.isfile() or member.isdir())
                or member.size < 0 or member.size > MAX_FILE_BYTES):
            raise ValueError(f"Unsafe archive member: {member.name!r}")
        if name in seen:
            raise ValueError("Duplicate archive member.")
        seen.add(name)
        if member.isdir():
            if path.parts[0] not in {"src", "lib", "data", "config"}:
                raise ValueError("Unexpected release directory.")
        elif allowed_source(name):
            selected.append(member)
        else:
            raise ValueError(f"File is outside the application source allowlist: {name}")
    if not REQUIRED.issubset({m.name for m in selected}):
        raise ValueError("Release archive is missing required application files.")
    return selected


def read_bundle(bundle: Path, expected_digest: str) -> bytes:
    if bundle.parent != INCOMING or not re.fullmatch(r"upload-[A-Za-z0-9]+\.tar", bundle.name):
        raise ValueError("Upload must be a controller-owned incoming-directory tar path.")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(bundle, flags), "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_BUNDLE_BYTES:
            raise ValueError("Upload must be a bounded regular file.")
        contents = handle.read(MAX_BUNDLE_BYTES + 1)
    if len(contents) > MAX_BUNDLE_BYTES or hashlib.sha256(contents).hexdigest() != digest_id(expected_digest):
        raise ValueError("Upload checksum verification failed.")
    return contents


def extract_bundle(contents: bytes, destination: Path) -> None:
    with tarfile.open(fileobj=io.BytesIO(contents), mode="r:") as archive:
        selected = validate_members(archive)
        destination.mkdir(mode=0o755)
        for member in selected:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o644)


def manifest(release: Path) -> dict:
    if release.is_symlink() or release.parent != RELEASES or not release.is_dir():
        raise ValueError("Unknown release directory.")
    commit_id(release.name)
    value = json.loads((release / ".release.json").read_text())
    if value.get("commit") != release.name or value.get("image") != image_name(release.name):
        raise ValueError("Release has no valid deployment manifest.")
    digest_id(value.get("bundle_sha256", ""))
    return value


def current_release() -> Path | None:
    pointer = ROOT / "current"
    if not pointer.is_symlink():
        if pointer.exists():
            raise ValueError("Current release pointer is not a symlink.")
        return None
    release = pointer.resolve(strict=True)
    manifest(release)
    return release


def verify_image(release: Path) -> None:
    value = manifest(release)
    info = json.loads(run("docker", "image", "inspect", value["image"], capture=True))[0]
    if (info["Id"] != value.get("image_id")
            or (info["Config"].get("Labels") or {}).get("org.opencontainers.image.revision") != release.name):
        raise ValueError("The release image does not match its immutable deployment manifest.")


def compose_up(commit: str) -> None:
    environment = dict(os.environ, ASTEROID_EXPLORER_IMAGE=image_name(commit))
    run("docker", "compose", "--env-file", str(ENVIRONMENT), "--project-directory", str(CONFIG),
        "-f", str(COMPOSE), "-p", "asteroid-explorer", "up", "-d", "--no-build",
        "--wait", "--wait-timeout", "90", env=environment)


def check_health() -> None:
    # Readiness is local and does not depend on an outbound JPL request.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(15):
        try:
            with opener.open("http://127.0.0.1:4173/healthz", timeout=3) as response:
                body = json.loads(response.read(4096))
                if response.status == 200 and body.get("ok") is True:
                    return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        if attempt != 14:
            time.sleep(2)
    raise ValueError("New application failed its loopback readiness check.")


def activate(release: Path, previous: Path | None) -> None:
    verify_image(release)
    try:
        compose_up(release.name)
        check_health()
    except Exception:
        if previous:
            print(f"Restoring previously healthy release {previous.name}.", flush=True)
            verify_image(previous)
            compose_up(previous.name)
            check_health()
        else:
            environment = dict(os.environ, ASTEROID_EXPLORER_IMAGE=image_name(release.name))
            run("docker", "compose", "--env-file", str(ENVIRONMENT), "-f", str(COMPOSE),
                "-p", "asteroid-explorer", "down", env=environment)
        raise
    pointer = ROOT / ".current-next"
    pointer.unlink(missing_ok=True)
    pointer.symlink_to(release)
    pointer.replace(ROOT / "current")


def freeze(release: Path) -> None:
    for path in release.rglob("*"):
        path.chmod(0o555 if path.is_dir() else 0o444)
    release.chmod(0o555)


def prune(keep: set[Path]) -> None:
    # Retain at least the active and previous release. Never delete unrecognized paths.
    known = []
    for release in RELEASES.iterdir():
        try:
            value = manifest(release)
            known.append((release.stat().st_mtime_ns, release, value))
        except (ValueError, OSError, json.JSONDecodeError):
            continue
    keep |= {item[1] for item in sorted(known, reverse=True)[:3]}
    for _, release, value in known:
        if release in keep:
            continue
        shutil.rmtree(release)
        subprocess.run(["docker", "image", "rm", value["image"]], check=False)


def deploy(bundle: Path, commit: str, expected_digest: str) -> None:
    previous = current_release()
    release = RELEASES / commit_id(commit)
    contents = read_bundle(bundle, expected_digest)
    dockerfile_digest = hashlib.sha256(DOCKERFILE.read_bytes()).hexdigest()
    if release.exists():
        value = manifest(release)
        if value.get("bundle_sha256") != expected_digest or value.get("dockerfile_sha256") != dockerfile_digest:
            raise ValueError("Existing immutable release differs; publish a new commit after reviewing build changes.")
        # Validate the archive even on repeated deployment.
        with tarfile.open(fileobj=io.BytesIO(contents), mode="r:") as archive:
            validate_members(archive)
        verify_image(release)
    else:
        try:
            extract_bundle(contents, release)
            run("docker", "build", "--pull", "--tag", image_name(commit), "--label",
                f"org.opencontainers.image.revision={commit}", "--file", str(DOCKERFILE), str(release))
            image_id = run("docker", "image", "inspect", "--format", "{{.Id}}", image_name(commit), capture=True)
            (release / ".release.json").write_text(json.dumps({
                "commit": commit, "image": image_name(commit), "image_id": image_id,
                "bundle_sha256": expected_digest, "dockerfile_sha256": dockerfile_digest,
            }) + "\n")
            freeze(release)
        except Exception:
            if release.is_dir() and not release.is_symlink():
                shutil.rmtree(release)
            raise
    activate(release, previous)
    prune({release, previous} - {None})
    print(f"Healthy release: {commit}", flush=True)


def rollback(commit: str) -> None:
    release = RELEASES / commit_id(commit)
    manifest(release)
    activate(release, current_release())
    print(f"Rolled back to healthy release: {commit}", flush=True)


def main() -> int:
    import fcntl

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rollback", metavar="COMMIT")
    parser.add_argument("bundle", nargs="?", type=Path)
    parser.add_argument("commit", nargs="?")
    parser.add_argument("sha256", nargs="?")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run this installed controller as root.")
    if ((args.rollback and any((args.bundle, args.commit, args.sha256)))
            or (not args.rollback and not all((args.bundle, args.commit, args.sha256)))):
        parser.error("Use BUNDLE COMMIT SHA256 or --rollback COMMIT.")
    for directory in (ROOT, RELEASES, CONFIG):
        check_directory(directory)
    for path in (COMPOSE, ENVIRONMENT, DOCKERFILE):
        check_installed_file(path)
    # INCOMING may be group-writable for the SSH publisher; source is copied and checked before use.
    if INCOMING.is_symlink() or not INCOMING.is_dir():
        parser.error("Incoming directory must be a real directory.")
    with (ROOT / ".deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.rollback:
            rollback(args.rollback)
        else:
            deploy(args.bundle, args.commit, args.sha256)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        raise SystemExit(f"Deployment failed: {error}")
