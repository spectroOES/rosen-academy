"""Load a verified frontend release; rebuild only after a real source change.

The Streamlit host serves the committed artifact without Node.js. During local
frontend development an installed npm can refresh that artifact automatically.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import logging
from pathlib import Path
import shutil
import subprocess
from threading import RLock
from typing import Callable

LOGGER = logging.getLogger(__name__)
SOURCE_FILES = (
    "index.html", "package.json", "package-lock.json", "tsconfig.json",
    "vite.config.ts", "scripts/export-standalone.mjs", "scripts/export-streamlit.mjs",
)


def source_hash(root: Path) -> str:
    """Same path-NUL-content-hash-LF contract as export-streamlit.mjs."""
    paths = list(SOURCE_FILES)
    for directory in ("src", "public"):
        for path in (root / directory).rglob("*"):
            if path.is_symlink():
                raise ValueError("Release sources must be regular files.")
            if path.is_file():
                paths.append(path.relative_to(root).as_posix())
    records = "".join(
        path + "\0" + sha256((root / path).read_bytes()).hexdigest() + "\n"
        for path in sorted(paths)
    )
    return sha256(records.encode()).hexdigest()


@dataclass(frozen=True)
class Release:
    html: str
    digest: str
    source_hash: str


def read_release(root: Path) -> Release:
    directory = root / "streamlit_assets"
    manifest = json.loads((directory / "manifest.json").read_text())
    if manifest.get("schemaVersion") != 1 or manifest.get("artifact") != "index.html":
        raise ValueError("Unsupported simulator release manifest.")
    data = (directory / "index.html").read_bytes()
    digest = sha256(data).hexdigest()
    if not data or digest != manifest.get("artifactHash") or len(data) != manifest.get("sizeBytes"):
        raise ValueError("Simulator artifact does not match its release manifest.")
    return Release(data.decode("utf-8"), digest, manifest["sourceHash"])


def build_frontend(root: Path) -> None:
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("Publish a frontend release with npm run build:streamlit.")
    result = subprocess.run(
        [npm, "run", "build:streamlit"], cwd=root, capture_output=True,
        text=True, timeout=120, check=False,
    )
    if result.returncode:
        LOGGER.error("Frontend build failed:\n%s\n%s", result.stdout, result.stderr)
        raise RuntimeError("The updated frontend could not be built.")


@dataclass(frozen=True)
class Snapshot:
    release: Release | None
    error: str | None = None

    @property
    def signature(self) -> tuple[str | None, str | None]:
        return (self.release.digest if self.release else None, self.error)


class SimulatorRuntime:
    """Shared build lock, per-source retry policy, and last-good-release cache."""

    def __init__(self, root: Path, builder: Callable[[Path], None] = build_frontend):
        self.root = root
        self.builder = builder
        self.lock = RLock()
        self.current: Release | None = None
        self.failed_source: str | None = None
        self.last_error: str | None = None
        self.force_build = False

    def refresh(self) -> Snapshot:
        with self.lock:
            try:
                # Only accept complete releases: an interrupted copy cannot
                # replace the cached working simulator.
                release = read_release(self.root)
                self.current = release
            except (OSError, ValueError, KeyError) as error:
                release = None
                LOGGER.debug("Release not available: %s", error)
            try:
                wanted = source_hash(self.root)
            except (OSError, ValueError) as error:
                LOGGER.warning("Could not inspect simulator sources: %s", error)
                return Snapshot(self.current, "The update could not be checked.")
            if release and release.source_hash == wanted and not self.force_build:
                self.failed_source = None
                self.last_error = None
                return Snapshot(release)
            if wanted == self.failed_source:
                return Snapshot(self.current, self.last_error)
            previous = self.current
            try:
                self.builder(self.root)
                built = read_release(self.root)
                after_build = source_hash(self.root)
                if after_build != wanted:
                    # A second save during compilation needs one more build.
                    self.force_build = True
                    return Snapshot(previous, "The latest update is still being prepared.")
                if built.source_hash != wanted:
                    raise ValueError("The frontend release is out of date.")
                self.current = built
                self.failed_source = None
                self.last_error = None
                self.force_build = False
                return Snapshot(built)
            except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
                self.failed_source = wanted
                self.last_error = "The latest update could not be loaded."
                LOGGER.warning("Simulator update failed: %s", error)
                return Snapshot(previous, self.last_error)
