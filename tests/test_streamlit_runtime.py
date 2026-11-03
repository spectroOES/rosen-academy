"""Release/runtime checks with temporary files; no npm build is executed."""
from hashlib import sha256
import json
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

from streamlit_runtime import SOURCE_FILES, SimulatorRuntime, read_release, source_hash


REPOSITORY = Path(__file__).resolve().parents[1]


class SimulatorRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(prefix="rosen-runtime-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for relative in SOURCE_FILES:
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"Fixture input: {relative}\n", encoding="utf-8")
        (self.root / "src" / "lib").mkdir(parents=True)
        (self.root / "src" / "lib" / "model.ts").write_text("export const slope = 12;\n")
        (self.root / "public").mkdir()
        (self.root / "public" / "favicon.svg").write_text("<svg/>\n")
        self.write_release("<html><body>Original calibration · 0.01–100 ppm</body></html>")

    def write_release(self, html):
        directory = self.root / "streamlit_assets"
        directory.mkdir(exist_ok=True)
        data = html.encode("utf-8")
        manifest = {
            "schemaVersion": 1,
            "artifact": "index.html",
            "artifactHash": sha256(data).hexdigest(),
            "sizeBytes": len(data),
            "sourceHash": source_hash(self.root),
        }
        (directory / "index.html").write_bytes(data)
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def edit_source(self, value):
        (self.root / "src" / "lib" / "model.ts").write_text(
            f"export const slope = {value};\n", encoding="utf-8"
        )

    def test_current_committed_release_works_without_node_or_a_builder(self):
        runtime = SimulatorRuntime(self.root)
        # The actual default builder remains installed. Neither locating npm
        # nor spawning a process is permitted for an unchanged release.
        with patch("streamlit_runtime.shutil.which", side_effect=AssertionError("npm must not be needed")), \
             patch("streamlit_runtime.subprocess.run", side_effect=AssertionError("must not launch Node")):
            first = runtime.refresh()
            second = runtime.refresh()
        self.assertIsNone(first.error)
        self.assertIsNone(second.error)
        self.assertIn("Original calibration", first.release.html)
        self.assertEqual(first.signature, second.signature)
        self.assertEqual(first.release.source_hash, source_hash(self.root))

    def test_changed_source_builds_once_and_repeated_refreshes_reuse_it(self):
        def build(root):
            self.assertEqual(root, self.root)
            self.write_release("<html><body>Updated calibration</body></html>")

        builder = Mock(side_effect=build)
        runtime = SimulatorRuntime(self.root, builder=builder)
        original = runtime.refresh()
        builder.assert_not_called()
        self.edit_source(13)
        updated = runtime.refresh()
        self.assertIsNone(updated.error)
        self.assertIn("Updated calibration", updated.release.html)
        self.assertNotEqual(original.release.digest, updated.release.digest)
        self.assertEqual(updated.release.source_hash, source_hash(self.root))
        for _ in range(3):
            self.assertEqual(runtime.refresh().signature, updated.signature)
        builder.assert_called_once_with(self.root)

    def test_failed_partial_build_keeps_last_good_html_and_retries_only_after_edit(self):
        def build(root):
            if builder.call_count == 1:
                # Simulate an interrupted write before a replacement manifest
                # exists. Cached working HTML must remain available.
                (root / "streamlit_assets" / "index.html").write_text("incomplete artifact")
                raise RuntimeError("Synthetic build failure")
            self.write_release("<html><body>Recovered calibration</body></html>")

        builder = Mock(side_effect=build)
        runtime = SimulatorRuntime(self.root, builder=builder)
        original = runtime.refresh()
        self.edit_source(13)
        with self.assertLogs("streamlit_runtime", level="WARNING"):
            failed = runtime.refresh()
        self.assertEqual(failed.release.html, original.release.html)
        self.assertIsNotNone(failed.error)
        for _ in range(3):
            self.assertEqual(runtime.refresh().signature, failed.signature)
        self.assertEqual(builder.call_count, 1)
        self.edit_source(14)
        recovered = runtime.refresh()
        self.assertEqual(builder.call_count, 2)
        self.assertIsNone(recovered.error)
        self.assertIn("Recovered calibration", recovered.release.html)
        self.assertEqual(runtime.refresh().signature, recovered.signature)
        self.assertEqual(builder.call_count, 2)

    def test_source_edit_during_build_requires_one_further_build(self):
        def build(_root):
            self.write_release(f"<html><body>Build {builder.call_count}</body></html>")
            if builder.call_count == 1:
                self.edit_source(14)

        builder = Mock(side_effect=build)
        runtime = SimulatorRuntime(self.root, builder=builder)
        original = runtime.refresh()
        self.edit_source(13)
        pending = runtime.refresh()
        self.assertEqual(pending.release.html, original.release.html)
        self.assertIsNotNone(pending.error)
        ready = runtime.refresh()
        self.assertIsNone(ready.error)
        self.assertIn("Build 2", ready.release.html)
        self.assertEqual(ready.release.source_hash, source_hash(self.root))
        self.assertEqual(runtime.refresh().signature, ready.signature)
        self.assertEqual(builder.call_count, 2)

    def test_invalid_manifest_or_corrupt_artifact_is_rejected(self):
        directory = self.root / "streamlit_assets"
        manifest_path = directory / "manifest.json"
        original = json.loads(manifest_path.read_text())
        for field, value in (
            ("schemaVersion", 2),
            ("artifact", "other.html"),
            ("artifactHash", "0" * 64),
            ("sizeBytes", original["sizeBytes"] + 1),
        ):
            with self.subTest(field=field):
                manifest_path.write_text(json.dumps({**original, field: value}))
                with self.assertRaises(ValueError):
                    read_release(self.root)
        manifest_path.write_text(json.dumps(original))
        (directory / "index.html").write_bytes(b"corrupted")
        with self.assertRaises(ValueError):
            read_release(self.root)
        manifest_path.write_text("{invalid json")
        with self.assertRaises(ValueError):
            read_release(self.root)

    def test_invalid_release_with_failed_builder_is_never_served(self):
        (self.root / "streamlit_assets" / "index.html").write_text("unverified bytes")
        builder = Mock(side_effect=RuntimeError("Builder unavailable"))
        runtime = SimulatorRuntime(self.root, builder=builder)
        with self.assertLogs("streamlit_runtime", level="WARNING"):
            failed = runtime.refresh()
        self.assertIsNone(failed.release)
        self.assertIsNotNone(failed.error)
        self.assertEqual(runtime.refresh().signature, failed.signature)
        builder.assert_called_once()

    def test_source_hash_tracks_relevant_changes_and_ignores_generated_files(self):
        original = source_hash(self.root)
        (self.root / "README.md").write_text("Changed deployment instructions")
        (self.root / "streamlit_assets" / "index.html").write_text("Generated asset")
        self.assertEqual(source_hash(self.root), original)
        (self.root / "src" / "new.ts").write_text("export const feature = true;\n")
        added = source_hash(self.root)
        self.assertNotEqual(added, original)
        (self.root / "src" / "new.ts").unlink()
        self.assertEqual(source_hash(self.root), original)
        self.edit_source(13)
        self.assertNotEqual(source_hash(self.root), original)

    @unittest.skipUnless(shutil.which("node"), "Node is only needed for exporter parity verification")
    def test_python_and_node_source_hashes_match_on_the_same_fixture(self):
        exporter = (REPOSITORY / "scripts" / "export-streamlit.mjs").as_uri()
        program = (
            f"import {{ calculateSourceHash }} from {json.dumps(exporter)};"
            "process.stdout.write(await calculateSourceHash(process.argv[1]));"
        )
        result = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e", program, str(self.root)],
            capture_output=True, text=True, timeout=15, check=True,
        )
        self.assertEqual(result.stdout, source_hash(self.root))


if __name__ == "__main__":
    unittest.main()
