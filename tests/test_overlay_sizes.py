import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import generate_obs_size_docs
from scripts.generate_obs_size_docs import DOC_PATH, update_size_section
from scripts.overlay_sizes import OverlaySizeConfigError, get_overlay_size, load_overlay_sizes


ROOT = Path(__file__).resolve().parents[1]


class OverlaySizeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "sizes.json")
        self.config = {
            "schema": 1,
            "default": {"width": 1920, "height": 1080},
            "overlays": [
                {"file": "fixed.html", "width": 320, "height": 240, "description": "fixed"},
                {"file": "variable.html", "width": None, "height": None, "description": "variable"},
            ],
        }

    def write_config(self):
        with open(self.path, "w", encoding="utf-8") as target:
            json.dump(self.config, target)

    def test_sizes_are_read_from_config_and_default_for_unspecified_or_unknown(self):
        self.write_config()
        self.assertEqual(get_overlay_size(self.path, "fixed.html"), (320, 240))
        self.assertEqual(get_overlay_size(self.path, "variable.html"), (1920, 1080))
        self.assertEqual(get_overlay_size(self.path, "other.html"), (1920, 1080))
        self.config["overlays"][0]["width"] = 480
        self.write_config()
        self.assertEqual(get_overlay_size(self.path, "fixed.html"), (480, 240))

    def test_shipped_default_and_explicit_sizes(self):
        config_path = ROOT / "config" / "overlay_sizes.json"
        self.assertEqual(get_overlay_size(config_path, "custom_overlay.html"), (800, 600))
        self.assertEqual(get_overlay_size(config_path, "LoL_Overlay_Landscape.html"), (1920, 1080))
        self.assertEqual(get_overlay_size(config_path, "LoL_Scoreboard_Overlay.html"), (720, 250))

    def test_missing_malformed_and_invalid_configs_fail_explicitly(self):
        with self.assertRaises(OverlaySizeConfigError):
            load_overlay_sizes(self.path)
        with open(self.path, "w", encoding="utf-8") as target:
            target.write("{")
        with self.assertRaises(OverlaySizeConfigError):
            load_overlay_sizes(self.path)

        for width, height in ((0, 1), (True, 1), (None, 1), ("320", 240)):
            with self.subTest(width=width, height=height):
                self.config["overlays"][0]["width"] = width
                self.config["overlays"][0]["height"] = height
                self.write_config()
                with self.assertRaises(OverlaySizeConfigError):
                    load_overlay_sizes(self.path)

        self.config["overlays"][0]["width"] = 320
        self.config["overlays"][0]["height"] = 240
        self.config["overlays"].append(dict(self.config["overlays"][0]))
        self.write_config()
        with self.assertRaises(OverlaySizeConfigError):
            load_overlay_sizes(self.path)

    def test_document_generated_section_matches_checked_in_config(self):
        config = load_overlay_sizes(ROOT / "config" / "overlay_sizes.json")
        document = DOC_PATH.read_text(encoding="utf-8")
        self.assertEqual(update_size_section(document, config), document)

    def test_document_generation_uses_json_values(self):
        self.config["default"] = {"width": 1280, "height": 720}
        self.config["overlays"][0]["description"] = "a | b"
        document = "before\n<!-- OBS_OVERLAY_SIZES_START -->\nold\n<!-- OBS_OVERLAY_SIZES_END -->\nafter\n"
        updated = update_size_section(document, self.config)
        self.assertIn("1280×720", updated)
        self.assertIn("| `html/fixed.html` | 320 | 240 | a \\| b |", updated)
        self.assertIn("| `html/variable.html` | 固定値なし | 固定値なし |", updated)
        self.assertTrue(updated.startswith("before\n"))
        self.assertTrue(updated.endswith("\nafter\n"))

    def test_generator_writes_document_and_check_detects_stale_table(self):
        self.write_config()
        document = Path(self.directory.name) / "instructions.md"
        document.write_text(
            "<!-- OBS_OVERLAY_SIZES_START -->\nold\n<!-- OBS_OVERLAY_SIZES_END -->\n",
            encoding="utf-8",
        )
        with patch.object(generate_obs_size_docs, "CONFIG_PATH", self.path), \
             patch.object(generate_obs_size_docs, "DOC_PATH", document), \
             patch.object(sys, "argv", ["generate_obs_size_docs", "--check"]):
            with self.assertRaises(SystemExit) as error:
                generate_obs_size_docs.main()
            self.assertEqual(error.exception.code, 1)
            with patch.object(sys, "argv", ["generate_obs_size_docs"]):
                generate_obs_size_docs.main()
            generate_obs_size_docs.main()
        self.assertIn("| `html/fixed.html` | 320 | 240 |", document.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
