"""Deployment boundary and recovery tests; no Docker, SSH or upstream calls."""

from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import publish
import server


COMMIT = "a" * 40
PREVIOUS = "b" * 40


def archive_bytes(extra: list[tarfile.TarInfo] | None = None, omit: str | None = None) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name in sorted(server.REQUIRED):
            if name == omit:
                continue
            member = tarfile.TarInfo(name)
            member.size = 2
            archive.addfile(member, io.BytesIO(b"{}"))
        for member in extra or []:
            archive.addfile(member, io.BytesIO(b"x" * member.size) if member.isfile() else None)
    return output.getvalue()


class ArchiveTests(unittest.TestCase):
    def validate(self, value: bytes):
        with tarfile.open(fileobj=io.BytesIO(value), mode="r:") as archive:
            return server.validate_members(archive)

    def test_complete_release_extracts_regular_allowlisted_files(self):
        contents = archive_bytes()
        self.assertEqual({m.name for m in self.validate(contents)}, server.REQUIRED)
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "release"
            server.extract_bundle(contents, destination)
            self.assertEqual({str(p.relative_to(destination)).replace("\\", "/")
                              for p in destination.rglob("*") if p.is_file()}, server.REQUIRED)

    def test_rejects_escape_hidden_secret_and_root_deployment_files(self):
        for name in ("../escape", "/etc/passwd", "src/../escape.js", "src\\escape.js",
                     ".env", "src/.env.json", "deploy/server.py", "Dockerfile", "secrets.json"):
            with self.subTest(name=name):
                member = tarfile.TarInfo(name)
                member.size = 1
                with self.assertRaises(ValueError):
                    self.validate(archive_bytes([member]))

    def test_rejects_symlinks_hardlinks_and_devices(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE):
            with self.subTest(kind=kind):
                member = tarfile.TarInfo("src/link.js")
                member.type = kind
                member.linkname = "../../outside"
                with self.assertRaises(ValueError):
                    self.validate(archive_bytes([member]))

    def test_rejects_duplicates_missing_files_and_oversized_entries(self):
        duplicate = tarfile.TarInfo("server.mjs")
        with self.assertRaises(ValueError):
            self.validate(archive_bytes([duplicate]))
        with self.assertRaises(ValueError):
            self.validate(archive_bytes(omit="data/main-belt-startup.json"))
        with patch.object(server, "MAX_FILE_BYTES", 1):
            with self.assertRaises(ValueError):
                self.validate(archive_bytes())
        with patch.object(server, "MAX_MEMBERS", 1):
            with self.assertRaises(ValueError):
                self.validate(archive_bytes())

    def test_upload_location_checksum_and_size_are_checked(self):
        contents = archive_bytes()
        with tempfile.TemporaryDirectory() as directory:
            incoming = Path(directory)
            bundle = incoming / "upload-Ab123.tar"
            bundle.write_bytes(contents)
            with patch.object(server, "INCOMING", incoming):
                self.assertEqual(server.read_bundle(bundle, hashlib.sha256(contents).hexdigest()), contents)
                with self.assertRaises(ValueError):
                    server.read_bundle(bundle, "0" * 64)
                with self.assertRaises(ValueError):
                    server.read_bundle(incoming / "other.tar", "0" * 64)
                with patch.object(server, "MAX_BUNDLE_BYTES", 1):
                    with self.assertRaises(ValueError):
                        server.read_bundle(bundle, "0" * 64)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO regression is covered on Linux CI")
    def test_fifo_upload_is_rejected_without_waiting_for_a_writer(self):
        with tempfile.TemporaryDirectory() as directory:
            incoming = Path(directory)
            bundle = incoming / "upload-Ab123.tar"
            os.mkfifo(bundle)
            with patch.object(server, "INCOMING", incoming), self.assertRaises(ValueError):
                server.read_bundle(bundle, "0" * 64)


class PublishTests(unittest.TestCase):
    def test_executable_resolution_handles_windows_npm_cmd(self):
        npm_path = "C:\\Node\\npm.CMD"
        with patch.object(publish.shutil, "which", return_value=npm_path), \
                patch.object(publish.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
            publish.run("npm", "test")
            self.assertEqual(run.call_args.args[0], [npm_path, "test"])

    def test_host_and_upload_path_reject_shell_injection(self):
        self.assertEqual(publish.check_host("my-host"), "my-host")
        self.assertEqual(publish.check_host("user@my-host.example"), "user@my-host.example")
        for host in ("-oProxyCommand=evil", "host;evil", "host $(evil)", "user@host:22"):
            with self.subTest(host=host), self.assertRaises(ValueError):
                publish.check_host(host)
        with self.assertRaises(ValueError):
            publish.check_upload_path("/tmp/not-our-upload.tar")
        self.assertEqual(publish.check_upload_path("/srv/asteroid-explorer/incoming/upload-A123.tar"),
                         "/srv/asteroid-explorer/incoming/upload-A123.tar")

    def test_publisher_excludes_secret_and_deployment_files_even_if_tracked(self):
        entries = [b"100644 blob " + b"0" * 40 + b"\t" + n.encode()
                   for n in sorted(server.REQUIRED | {".env", "deploy/server.py", "Dockerfile", "README.md"})]
        result = subprocess.CompletedProcess([], 0, b"\0".join(entries) + b"\0")
        with patch.object(publish.subprocess, "run", return_value=result):
            self.assertEqual(set(publish.source_paths(COMMIT)), server.REQUIRED)

    def test_publisher_rejects_tracked_symlinks(self):
        entries = [b"100644 blob " + b"0" * 40 + b"\t" + n.encode()
                   for n in sorted(server.REQUIRED)]
        entries.append(b"120000 blob " + b"0" * 40 + b"\tsrc/link.js")
        result = subprocess.CompletedProcess([], 0, b"\0".join(entries) + b"\0")
        with patch.object(publish.subprocess, "run", return_value=result), self.assertRaises(ValueError):
            publish.source_paths(COMMIT)

    def test_dirty_checkout_is_rejected(self):
        with patch.object(publish, "run", return_value=" M server.mjs"), self.assertRaises(ValueError):
            publish.clean_commit()


class RecoveryTests(unittest.TestCase):
    def test_failed_update_restarts_previous_and_preserves_current_pointer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release, previous = root / COMMIT, root / PREVIOUS
            calls = []
            with patch.object(server, "ROOT", root), patch.object(server, "verify_image"), \
                    patch.object(server, "compose_up", side_effect=lambda commit: calls.append(commit)), \
                    patch.object(server, "check_health", side_effect=[ValueError("not ready"), None]):
                with self.assertRaisesRegex(ValueError, "not ready"):
                    server.activate(release, previous)
            self.assertEqual(calls, [COMMIT, PREVIOUS])
            self.assertFalse((root / "current").exists())

    def test_successful_update_only_publishes_pointer_after_readiness(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / COMMIT
            with patch.object(server, "ROOT", root), patch.object(server, "verify_image"), \
                    patch.object(server, "compose_up"), patch.object(server, "check_health") as health:
                try:
                    server.activate(release, None)
                except OSError as error:
                    if getattr(error, "winerror", None) == 1314:
                        self.skipTest("Windows account lacks symlink privilege; Linux CI covers atomic activation.")
                    raise
            health.assert_called_once()
            self.assertEqual((root / "current").resolve(), release.resolve())

    def test_first_failed_deployment_stops_candidate(self):
        with patch.object(server, "verify_image"), patch.object(server, "compose_up"), \
                patch.object(server, "check_health", side_effect=ValueError("not ready")), \
                patch.object(server, "run") as run:
            with self.assertRaises(ValueError):
                server.activate(Path("/unused") / COMMIT, None)
            self.assertIn("down", run.call_args.args)

    def test_release_id_rejects_paths(self):
        for value in ("main", "a" * 39, "../release", "A" * 40):
            with self.subTest(value=value), self.assertRaises(ValueError):
                server.commit_id(value)

    def test_same_commit_requires_same_bundle_and_trusted_build_recipe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            releases, incoming = root / "releases", root / "incoming"
            releases.mkdir()
            incoming.mkdir()
            release = releases / COMMIT
            release.mkdir()
            bundle = incoming / "upload-Ab123.tar"
            bundle.write_bytes(archive_bytes())
            digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
            dockerfile = root / "Dockerfile"
            dockerfile.write_text("trusted recipe")
            value = {"commit": COMMIT, "image": server.image_name(COMMIT),
                     "bundle_sha256": digest, "dockerfile_sha256": "0" * 64}
            (release / ".release.json").write_text(json.dumps(value))
            with patch.object(server, "RELEASES", releases), patch.object(server, "INCOMING", incoming), \
                    patch.object(server, "DOCKERFILE", dockerfile), patch.object(server, "current_release", return_value=None):
                with self.assertRaisesRegex(ValueError, "immutable release differs"):
                    server.deploy(bundle, COMMIT, digest)


if __name__ == "__main__":
    unittest.main()
