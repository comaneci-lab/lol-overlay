import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class InteractiveBuildVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        scripts = self.root / "scripts"
        scripts.mkdir()
        for name in ("write_build_version.py", "write_app_update_manifest.py"):
            shutil.copyfile(ROOT / "scripts" / name, scripts / name)
        (self.root / ".gitignore").write_text("build/\n__pycache__/\n", encoding="utf-8")
        self.git("init", "--quiet")
        self.git("add", ".")
        self.commit("initial")

    def git(self, *args):
        return subprocess.run(
            ["git", *args],
            cwd=self.root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    def commit(self, message):
        self.git(
            "-c", "user.name=Build Test",
            "-c", "user.email=build-test@example.invalid",
            "commit", "--quiet", "-m", message,
        )

    def run_build_version(self, answers):
        return subprocess.run(
            [sys.executable, str(self.root / "scripts" / "write_build_version.py"), "--interactive"],
            cwd=self.root,
            input=answers,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, "PYTHONUTF8": "1"},
        )

    def read_version(self):
        return json.loads(
            (self.root / "build" / "app_version.json").read_text(encoding="utf-8")
        )

    def test_release_creates_tag_and_can_reuse_it(self):
        for _ in range(2):
            result = self.run_build_version("2\nv1.2.3\n")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                self.read_version(),
                {"version": "v1.2.3", "commit_sha": self.git("rev-parse", "HEAD")},
            )
        self.assertEqual(self.git("rev-parse", "v1.2.3"), self.git("rev-parse", "HEAD"))

    def test_development_build_ignores_existing_head_tag(self):
        self.git("tag", "v1.2.3")
        result = self.run_build_version("1\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.read_version()["version"], "開発版")

    def test_release_rejects_dirty_worktree_and_invalid_tag(self):
        result = self.run_build_version("2\ninvalid-tag\n")
        self.assertNotEqual(result.returncode, 0)
        (self.root / "new-file").write_text("uncommitted", encoding="utf-8")
        result = self.run_build_version("2\nv1.2.3\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("tag", "--list"), "")

    def test_release_rejects_tag_on_another_commit(self):
        self.git("tag", "v1.2.3")
        (self.root / "new-file").write_text("committed", encoding="utf-8")
        self.git("add", "new-file")
        self.commit("next")
        result = self.run_build_version("2\nv1.2.3\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotEqual(self.git("rev-parse", "v1.2.3"), self.git("rev-parse", "HEAD"))
        self.assertFalse((self.root / "build" / "app_version.json").exists())


if __name__ == "__main__":
    unittest.main()
