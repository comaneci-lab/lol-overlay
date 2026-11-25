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
        shutil.copyfile(ROOT / "build.bat", self.root / "build.bat")
        for directory in ("html", "css", "js", "assets", "config"):
            (self.root / directory).mkdir()
            (self.root / directory / "fixture.txt").write_text("fixture", encoding="utf-8")
        (self.root / ".gitignore").write_text("build/\ndist/\n__pycache__/\n", encoding="utf-8")
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

    def configure_remote(self):
        remote = self.root / ".git" / "test-remote.git"
        subprocess.run(["git", "init", "--bare", "--quiet", str(remote)], check=True)
        self.git("remote", "add", "origin", str(remote))

    def run_push_tag(self):
        return subprocess.run(
            [sys.executable, str(self.root / "scripts" / "write_build_version.py"), "--push-tag"],
            cwd=self.root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, "PYTHONUTF8": "1"},
        )

    def run_batch(self, answers, pyinstaller_code):
        fake_packages = self.root / ".git" / "fake-packages"
        package = fake_packages / "PyInstaller"
        package.mkdir(parents=True, exist_ok=True)
        (package / "__init__.py").write_text("", encoding="utf-8")
        (package / "__main__.py").write_text(pyinstaller_code, encoding="utf-8")
        return subprocess.run(
            [os.environ.get("COMSPEC", "cmd.exe"), "/c", str(self.root / "build.bat")],
            cwd=self.root,
            input=answers,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={
                **os.environ,
                "PYTHONUTF8": "1",
                "PYTHONPATH": str(fake_packages),
                "PATH": str(Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", ""),
            },
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

    @unittest.skipUnless(os.name == "nt", "build.bat requires Windows")
    def test_batch_pushes_release_tag_only_after_successful_build(self):
        self.configure_remote()
        result = self.run_batch(
            "2\nv1.2.3\n",
            "from pathlib import Path\n"
            "Path('dist').mkdir(exist_ok=True)\n"
            "Path('dist/LoLAPIGet.exe').write_bytes(b'test executable')\n",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f"{self.git('rev-parse', 'HEAD')}\trefs/tags/v1.2.3", self.git("ls-remote", "--tags", "origin"))
        manifest = json.loads((self.root / "dist" / "app-update.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["commit_sha"], self.git("rev-parse", "v1.2.3"))
        self.assertEqual(self.run_push_tag().returncode, 0)

    @unittest.skipUnless(os.name == "nt", "build.bat requires Windows")
    def test_batch_does_not_push_after_build_failure_or_for_development(self):
        self.configure_remote()
        result = self.run_batch("2\nv1.2.3\n", "raise SystemExit(17)\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git("tag", "--list"), "v1.2.3")
        self.assertEqual(self.git("ls-remote", "--tags", "origin"), "")
        result = self.run_batch(
            "1\n",
            "from pathlib import Path\n"
            "Path('dist').mkdir(exist_ok=True)\n"
            "Path('dist/LoLAPIGet.exe').write_bytes(b'test executable')\n",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.git("ls-remote", "--tags", "origin"), "")

    @unittest.skipUnless(os.name == "nt", "build.bat requires Windows")
    def test_batch_fails_when_release_tag_push_fails(self):
        result = self.run_batch(
            "2\nv1.2.3\n",
            "from pathlib import Path\n"
            "Path('dist').mkdir(exist_ok=True)\n"
            "Path('dist/LoLAPIGet.exe').write_bytes(b'test executable')\n",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("タグを push できませんでした", result.stderr)
        self.assertNotIn("Build complete", result.stdout)
        self.assertEqual(self.git("tag", "--list"), "v1.2.3")

    def test_push_rejects_dirty_or_changed_commit(self):
        self.configure_remote()
        self.assertEqual(self.run_build_version("2\nv1.2.3\n").returncode, 0)
        (self.root / "new-file").write_text("changed", encoding="utf-8")
        result = self.run_push_tag()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("未コミット", result.stderr)
        self.git("add", "new-file")
        self.commit("changed during build")
        result = self.run_push_tag()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("コミットが変更", result.stderr)
        self.assertEqual(self.git("ls-remote", "--tags", "origin"), "")

    def test_push_failure_is_reported(self):
        self.assertEqual(self.run_build_version("2\nv1.2.3\n").returncode, 0)
        result = self.run_push_tag()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("タグを push できませんでした", result.stderr)


if __name__ == "__main__":
    unittest.main()
