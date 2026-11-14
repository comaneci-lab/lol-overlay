import hashlib
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import LoLProxy


class FakeResponse:
    def __init__(self, content, status_code=200, json_data=None):
        self.content = content
        self.status_code = status_code
        self.json_data = json_data

    def __enter__(self):
        return self

    def __exit__(self, _exception_type, _exception, _traceback):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise LoLProxy.requests.HTTPError(f"status {self.status_code}")

    def json(self):
        return self.json_data

    def iter_content(self, chunk_size):
        del chunk_size
        yield self.content


class OverlayUpdateTests(unittest.TestCase):
    def setUp(self):
        self.install_root = tempfile.TemporaryDirectory()
        self.addCleanup(self.install_root.cleanup)
        self.version = "a" * 40
        self.path = "js/update_test.js"
        self.expected_content = b"const updated = true;"
        self.manifest = {
            "schema": 1,
            "version": self.version,
            "files": [{
                "path": self.path,
                "size": len(self.expected_content),
                "sha256": hashlib.sha256(self.expected_content).hexdigest(),
            }],
        }
        self.manifest_url = "https://updates.example.test/lol-overlay/update-manifest.json"
        self.base_url = "https://updates.example.test/lol-overlay"

    def patch_update_settings(self):
        for name, value in (
            ("APP_DIR", self.install_root.name),
            ("OVERLAY_UPDATE_MANIFEST_URL", self.manifest_url),
            ("OVERLAY_UPDATE_BASE_URL", self.base_url),
        ):
            patcher = patch.object(LoLProxy, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def response_for(self, url, file_content=None):
        if url == self.manifest_url:
            content = json.dumps(self.manifest).encode("utf-8")
            return FakeResponse(content, json_data=self.manifest)
        return FakeResponse(file_content)

    def test_installs_manifest_files_and_skips_them_when_current(self):
        self.patch_update_settings()
        requests_seen = []

        def fake_get(url, **_kwargs):
            requests_seen.append(url)
            return self.response_for(url, self.expected_content)

        with patch.object(LoLProxy.requests, "get", side_effect=fake_get):
            result = LoLProxy.update_overlay_files()
            latest_result = LoLProxy.update_overlay_files()

        target_path = os.path.join(self.install_root.name, "js", "update_test.js")
        with open(target_path, "rb") as installed_file:
            self.assertEqual(installed_file.read(), self.expected_content)
        self.assertEqual(result, {"version": self.version, "updated_files": 1})
        self.assertEqual(latest_result, {"version": self.version, "updated_files": 0})
        self.assertEqual(len(requests_seen), 3)

    def test_hash_mismatch_does_not_replace_existing_file(self):
        self.patch_update_settings()
        target_path = os.path.join(self.install_root.name, "js", "update_test.js")
        os.makedirs(os.path.dirname(target_path))
        with open(target_path, "wb") as existing_file:
            existing_file.write(b"existing content")

        def fake_get(url, **_kwargs):
            return self.response_for(url, b"tampered content")

        with patch.object(LoLProxy.requests, "get", side_effect=fake_get):
            with self.assertRaises(LoLProxy.OverlayUpdateError):
                LoLProxy.update_overlay_files()

        with open(target_path, "rb") as existing_file:
            self.assertEqual(existing_file.read(), b"existing content")

    def test_rejects_paths_outside_overlay_directories(self):
        manifest = {
            "schema": 1,
            "version": self.version,
            "files": [{
                "path": "../settings.ini",
                "size": 1,
                "sha256": "0" * 64,
            }],
        }
        with self.assertRaises(LoLProxy.OverlayUpdateError):
            LoLProxy.validate_overlay_update_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
