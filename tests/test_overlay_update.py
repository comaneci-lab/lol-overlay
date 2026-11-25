import io
import hashlib
import importlib.util
import json
import os
import posixpath
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

import LoLProxy
from scripts.OBSAdpter import OBSOverlayError


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


class FakeVariable:
    def set(self, value):
        self.value = value


class FakeButton:
    def state(self, values):
        self.last_state = values


class SpectatorEditorTests(unittest.TestCase):
    def test_editor_stays_visible_and_only_enables_during_spectating(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.attributes("-alpha", 0.0)
        data = LoLProxy.default_spectator_data()
        with patch.object(LoLProxy, "get_language_code", return_value="ja_JP"), \
             patch.object(LoLProxy, "get_spectator_data", return_value=data), \
             patch.object(LoLProxy, "get_spectator_data_revision", return_value=0), \
             patch.object(root, "after"), \
             patch.object(LoLProxy.SpectatorDataEditor, "load_obs_settings", return_value=False), \
             patch.object(LoLProxy.SpectatorDataEditor, "start_update_checks"), \
             patch.object(LoLProxy.SpectatorDataEditor, "refresh_live_api"):
            editor = LoLProxy.SpectatorDataEditor(root)

        editor.tabs.select(1)
        root.update()
        self.assertTrue(editor.editor_panel.winfo_ismapped())
        self.assertFalse(any(
            isinstance(child, LoLProxy.ttk.Checkbutton)
            for child in editor.editor_panel.master.winfo_children()
            for child in child.winfo_children()
        ))
        def find_entry(widget):
            if isinstance(widget, LoLProxy.ttk.Entry):
                return widget
            for child in widget.winfo_children():
                found = find_entry(child)
                if found is not None:
                    return found
            return None

        entry = find_entry(editor.editor_panel)
        self.assertIsNotNone(entry)
        self.assertTrue(entry.instate(["disabled"]))
        with patch.object(LoLProxy, "get_spectator_data", return_value=data), \
             patch.object(LoLProxy, "get_spectator_data_revision", return_value=0), \
             patch.object(LoLProxy, "get_current_game_time", return_value=0), \
             patch.object(LoLProxy, "fetch_lcu", return_value={"ok": True, "data": {}}), \
             patch.object(LoLProxy, "observe_live_api", return_value=True) as observe, \
             patch.object(LoLProxy, "is_spectator_game_data", return_value=True) as spectator, \
             patch.object(root, "after"), \
             patch.object(editor, "show_save_error"):
            editor.refresh_live_api()
            self.assertTrue(entry.instate(["!disabled"]))
            spectator.return_value = False
            editor.refresh_live_api()
            self.assertTrue(entry.instate(["disabled"]))
            spectator.return_value = True
            editor.refresh_live_api()
            self.assertTrue(entry.instate(["!disabled"]))
            observe.return_value = False
            editor.refresh_live_api()
            self.assertTrue(entry.instate(["disabled"]))
            observe.return_value = True
            editor.refresh_live_api()
            self.assertTrue(entry.instate(["!disabled"]))
            observe.side_effect = ValueError("unavailable")
            editor.refresh_live_api()
            self.assertTrue(entry.instate(["disabled"]))
            self.assertTrue(editor.editor_panel.winfo_ismapped())

    def test_legacy_disabled_setting_does_not_hide_spectator_data(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "settings.ini")
            with open(path, "w", encoding="utf-8") as settings:
                settings.write("[settings]\nlanguage = ja_JP\nspectator_mode = false\n")
            manual_data = LoLProxy.default_spectator_data()
            with patch.object(LoLProxy, "CONFIG_PATH", path), \
                 patch.object(LoLProxy, "fetch_lcu", return_value={"ok": True, "data": {}}), \
                 patch.object(LoLProxy, "observe_live_api", return_value=True), \
                 patch.object(LoLProxy, "get_spectator_data", return_value=manual_data):
                LoLProxy.initialize_settings()
                response = LoLProxy.app.test_client().get("/allgamedata")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json()["data"]["spectatorData"], manual_data)


class HtmlFileListTests(unittest.TestCase):
    def test_selected_tab_is_larger_than_when_unselected(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.withdraw()
        root.attributes("-alpha", 0.0)
        with patch.object(LoLProxy, "get_language_code", return_value="ja_JP"), \
             patch.object(LoLProxy.SpectatorDataEditor, "load_obs_settings", return_value=False), \
             patch.object(LoLProxy.SpectatorDataEditor, "refresh_live_api"), \
             patch.object(LoLProxy.SpectatorDataEditor, "start_update_checks"):
            editor = LoLProxy.SpectatorDataEditor(root)
            root.deiconify()
            root.update()
            self.assertEqual(
                [editor.tabs.tab(index, "text") for index in range(4)],
                ["管理", "観戦", "設定", "更新"],
            )
            self.assertEqual(str(editor.obs_port_entry.master), editor.tabs.tabs()[2])

            def tab_width(index):
                positions = []
                for x in range(400):
                    for y in range(60):
                        try:
                            if editor.tabs.index(f"@{x},{y}") == index:
                                positions.append(x)
                                break
                        except LoLProxy.tk.TclError:
                            pass
                self.assertTrue(positions)
                return max(positions) - min(positions) + 1

            selected_width = tab_width(0)
            editor.tabs.select(2)
            root.update()
            self.assertGreater(selected_width, tab_width(0))

    def test_lists_html_files_in_case_insensitive_order(self):
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        with tempfile.TemporaryDirectory() as app_dir:
            html_dir = os.path.join(app_dir, "html")
            os.makedirs(html_dir)
            for filename in ("b_overlay.html", "A_overlay.html", "notes.txt"):
                with open(os.path.join(html_dir, filename), "w", encoding="utf-8"):
                    pass
            os.makedirs(os.path.join(html_dir, "not-a-file.html"))

            with patch.object(LoLProxy, "APP_DIR", app_dir):
                self.assertEqual(
                    editor.get_html_files(),
                    ["A_overlay.html", "b_overlay.html"],
                )

    def test_rows_open_and_copy_their_own_urls_and_scroll(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.withdraw()
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = root
        filenames = [f"overlay {index:02}.html" for index in range(30)]
        editor.get_html_files = Mock(return_value=filenames)
        tab = LoLProxy.ttk.Frame(root)
        tab.pack(fill="both", expand=True)
        editor.create_html_view(tab)
        root.update_idletasks()

        first_row = editor.html_rows.grid_slaves(row=1, column=0)[0]
        last_row = editor.html_rows.grid_slaves(row=59, column=0)[0]
        self.assertEqual(first_row.grid_slaves(row=1, column=0)[0].cget("text"), filenames[0])
        self.assertEqual(last_row.grid_slaves(row=1, column=0)[0].cget("text"), filenames[-1])
        first_browser = editor.html_rows.grid_slaves(row=1, column=2)[0]
        last_browser = editor.html_rows.grid_slaves(row=59, column=2)[0]
        first_buttons = first_browser.grid_slaves(row=0, column=0)[0]
        last_buttons = last_browser.grid_slaves(row=0, column=0)[0]
        with patch.object(editor, "open_file") as open_file, \
             patch.object(editor, "copy_html_url") as copy_html_url:
            first_buttons.grid_slaves(row=0, column=0)[0].invoke()
            last_buttons.grid_slaves(row=0, column=1)[0].invoke()
        open_file.assert_called_once_with(filenames[0])
        copy_html_url.assert_called_once_with(filenames[-1])

        self.assertGreater(editor.html_canvas.bbox("all")[3], 100)
        scrollbar = next(
            child for child in editor.html_canvas.master.winfo_children()
            if isinstance(child, LoLProxy.ttk.Scrollbar)
        )
        scrollbar.tk.call(scrollbar.cget("command"), "moveto", "1")
        self.assertGreater(editor.html_canvas.yview()[0], 0)
        editor.get_html_files.return_value = ["new.html"]
        editor.refresh_html_files()
        root.update_idletasks()
        self.assertEqual(len(editor.obs_buttons), 1)
        item = editor.html_rows.grid_slaves(row=1, column=0)[0]
        self.assertEqual(item.grid_slaves(row=1, column=0)[0].cget("text"), "new.html")

    def test_copy_and_open_encode_the_filename(self):
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = Mock()
        editor.html_status = FakeVariable()
        filename = "日本語 #1.html"
        url = "http://127.0.0.1:8888/html/%E6%97%A5%E6%9C%AC%E8%AA%9E%20%231.html"
        editor.copy_html_url(filename)
        editor.root.clipboard_append.assert_called_once_with(url)
        with patch.object(LoLProxy.webbrowser, "open", return_value=True) as open_browser:
            editor.open_file(filename)
        open_browser.assert_called_once_with(url)

    def test_refresh_button_notifies_only_after_success(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.withdraw()
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = root
        editor.get_html_files = Mock(return_value=["first.html"])
        tab = LoLProxy.ttk.Frame(root)
        with patch.object(LoLProxy.messagebox, "showinfo") as showinfo:
            editor.create_html_view(tab)
            showinfo.assert_not_called()
            controls = tab.grid_slaves(row=2, column=0)[0]
            button = controls.grid_slaves(row=0, column=0)[0]
            editor.get_html_files.return_value = ["updated.html"]
            button.invoke()
            item = editor.html_rows.grid_slaves(row=1, column=0)[0]
            self.assertEqual(item.grid_slaves(row=1, column=0)[0].cget("text"), "updated.html")
            showinfo.assert_called_once_with("一覧を更新", "更新完了しました。", parent=root)

            showinfo.reset_mock()
            editor.get_html_files.return_value = []
            button.invoke()
            showinfo.assert_called_once_with("一覧を更新", "更新完了しました。", parent=root)
            self.assertEqual(editor.html_status.get(), "HTMLファイルが見つかりません。")

            showinfo.reset_mock()
            editor.get_html_files.side_effect = OSError("read failed")
            button.invoke()
            showinfo.assert_not_called()
            self.assertIn("read failed", editor.html_status.get())
        root.update_idletasks()

    def test_mouse_wheel_scrolls_over_list_widgets_after_refresh(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.withdraw()
        root.geometry("600x250")
        root.attributes("-alpha", 0.0)
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = root
        editor.get_html_files = Mock(
            return_value=[f"overlay{index:02}.html" for index in range(30)]
        )
        tab = LoLProxy.ttk.Frame(root)
        tab.pack(fill="both", expand=True)
        editor.create_html_view(tab)
        root.deiconify()
        root.update()
        editor.refresh_html_files()
        root.update()

        widgets = [editor.html_canvas, editor.html_rows]
        widgets.extend(editor.html_rows.winfo_children()[:7])
        for widget in widgets:
            with self.subTest(widget=widget):
                editor.html_canvas.yview_moveto(0)
                root.update()
                widget.event_generate("<MouseWheel>", delta=-120)
                root.update()
                self.assertGreater(editor.html_canvas.yview()[0], 0)
                widget.event_generate("<MouseWheel>", delta=120)
                root.update()
                self.assertEqual(editor.html_canvas.yview()[0], 0)

        tab.event_generate("<MouseWheel>", delta=-120)
        root.update()
        self.assertEqual(editor.html_canvas.yview()[0], 0)

    def test_obs_buttons_follow_state_and_remain_scoped_to_each_row(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.withdraw()
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = root
        editor.get_html_files = Mock(return_value=["a.html", "b.html"])
        editor.create_html_view(LoLProxy.ttk.Frame(root))
        editor.obs_active = True
        editor.obs_state = {
            "scene": "Scene",
            "overlays": {
                "a.html": {"exists": True, "managed": True, "items": [(1, True)]},
                "b.html": {"exists": False, "managed": False, "items": []},
            },
        }
        editor.update_obs_buttons()
        first, second = editor.obs_buttons["a.html"], editor.obs_buttons["b.html"]
        self.assertTrue(first["add"].instate(["disabled"]))
        self.assertTrue(first["show"].instate(["disabled"]))
        self.assertFalse(first["hide"].instate(["disabled"]))
        self.assertFalse(first["delete"].instate(["disabled"]))
        self.assertFalse(second["add"].instate(["disabled"]))
        self.assertTrue(second["delete"].instate(["disabled"]))
        with patch.object(editor, "start_obs_action") as action:
            first["hide"].invoke()
            second["add"].invoke()
        self.assertEqual(action.call_args_list[0].args, ("hide", "a.html"))
        self.assertEqual(action.call_args_list[1].args, ("add", "b.html"))
        editor.obs_state["overlays"]["a.html"] = {
            "exists": True, "managed": False, "items": []
        }
        editor.update_obs_buttons()
        self.assertTrue(all(button.instate(["disabled"]) for button in first.values()))
        root.update_idletasks()

    def test_delete_is_cancelled_if_state_changes_during_confirmation(self):
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = Mock()
        editor.obs_busy = False
        editor.obs_active = True
        editor.obs_state = {"scene": "First"}

        def change_scene(*_args, **_kwargs):
            editor.obs_state = {"scene": "Second"}
            return True

        with patch.object(LoLProxy.messagebox, "askyesno", side_effect=change_scene), \
             patch.object(LoLProxy.messagebox, "showerror") as showerror, \
             patch.object(editor, "start_obs_request") as request:
            editor.start_obs_action("delete", "a.html")
        request.assert_not_called()
        showerror.assert_called_once()

    def test_missing_html_refreshes_list_after_add_error(self):
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = Mock()
        editor.obs_busy = False
        editor.obs_active = True
        editor.obs_state = {"scene": "Scene"}
        with patch.object(LoLProxy.os.path, "isfile", return_value=False), \
             patch.object(LoLProxy.messagebox, "showerror") as showerror, \
             patch.object(editor, "refresh_html_files") as refresh:
            editor.start_obs_action("add", "missing.html")
        showerror.assert_called_once()
        refresh.assert_called_once_with()

    def test_invalid_size_config_blocks_add_but_not_other_actions(self):
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = Mock()
        editor.obs_busy = False
        editor.obs_active = True
        editor.obs_state = {"scene": "Scene"}
        with patch.object(LoLProxy.os.path, "isfile", return_value=True), \
             patch.object(LoLProxy, "get_overlay_size", side_effect=LoLProxy.OverlaySizeConfigError("bad config")), \
             patch.object(LoLProxy.messagebox, "showerror") as showerror, \
             patch.object(editor, "start_obs_request") as request:
            editor.start_obs_action("add", "a.html")
            showerror.assert_called_once()
            self.assertIn("bad config", showerror.call_args.args[1])
            request.assert_not_called()
            editor.start_obs_action("hide", "a.html")
            request.assert_called_once_with("hide", "a.html", notify_error=True, dimensions=None)

    def test_obs_connection_and_add_update_buttons(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.withdraw()
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = root
        editor.get_html_files = Mock(return_value=["a.html"])
        editor.create_html_view(LoLProxy.ttk.Frame(root))
        with patch.object(editor, "load_obs_settings", return_value=False):
            editor.create_obs_settings_view(LoLProxy.ttk.Frame(root))
        before = {"scene": "Scene", "overlays": {
            "a.html": {"exists": False, "managed": False, "items": []}
        }}
        after = {"scene": "Scene", "overlays": {
            "a.html": {"exists": True, "managed": True, "items": [(7, True)]}
        }}
        changed = {"scene": "Scene", "overlays": {
            "a.html": {"exists": True, "managed": True, "items": [(7, False)]}
        }}
        adapter = Mock()
        adapter.get_overlay_state.side_effect = [before, before, after, changed, after, before, after]
        context = Mock()
        context.__enter__ = Mock(return_value=adapter)
        context.__exit__ = Mock(return_value=False)

        def wait_for_request():
            deadline = time.monotonic() + 3
            while editor.obs_busy and time.monotonic() < deadline:
                root.update()
                time.sleep(0.01)
            self.assertFalse(editor.obs_busy)

        with tempfile.TemporaryDirectory() as app_dir, \
             patch.object(LoLProxy, "APP_DIR", app_dir), \
             patch.object(LoLProxy, "OVERLAY_SIZE_CONFIG_PATH", os.path.join(app_dir, "sizes.json")), \
             patch.object(editor, "load_saved_obs_password"), \
             patch.object(LoLProxy, "save_obs_port") as save_port, \
             patch.object(LoLProxy, "save_obs_password") as save_password, \
             patch.object(LoLProxy.messagebox, "askyesno", return_value=True) as confirm_save, \
             patch.object(LoLProxy, "OBSOverlayAdapter", return_value=context):
            os.makedirs(os.path.join(app_dir, "html"))
            with open(os.path.join(app_dir, "html", "a.html"), "w", encoding="utf-8"):
                pass
            config = {
                "schema": 1,
                "default": {"width": 1920, "height": 1080},
                "overlays": [{"file": "a.html", "width": 320, "height": 240, "description": ""}],
            }
            with open(LoLProxy.OVERLAY_SIZE_CONFIG_PATH, "w", encoding="utf-8") as file:
                json.dump(config, file)
            editor.obs_password.set("temporary")
            editor.toggle_obs_connection()
            wait_for_request()
            save_port.assert_called_once_with(4455)
            confirm_save.assert_called_once()
            save_password.assert_called_once_with("temporary")
            self.assertFalse(editor.obs_buttons["a.html"]["add"].instate(["disabled"]))
            deadline = time.monotonic() + 3.2
            while time.monotonic() < deadline:
                root.update()
                time.sleep(0.01)
            self.assertEqual(adapter.get_overlay_state.call_count, 1)
            editor.start_obs_request()
            wait_for_request()
            save_port.assert_called_once()
            confirm_save.assert_called_once()
            editor.obs_buttons["a.html"]["add"].invoke()
            wait_for_request()
            adapter.apply_overlay_action.assert_called_once_with(
                "add", "a.html", before, (320, 240)
            )
            self.assertTrue(editor.obs_buttons["a.html"]["add"].instate(["disabled"]))
            self.assertFalse(editor.obs_buttons["a.html"]["hide"].instate(["disabled"]))
            config["overlays"][0]["width"] = 640
            with open(LoLProxy.OVERLAY_SIZE_CONFIG_PATH, "w", encoding="utf-8") as file:
                json.dump(config, file)
            for action, error, expected, enabled_action in (
                ("hide", "既に非表示です", changed, "show"),
                ("show", "既に表示されています", after, "hide"),
                ("delete", "ソースがありません", before, "add"),
                ("add", "同名のソースが既に存在します", after, "hide"),
            ):
                with self.subTest(action=action), \
                     patch.object(LoLProxy.messagebox, "askyesno", return_value=True), \
                     patch.object(LoLProxy.messagebox, "showerror") as showerror, \
                     patch.object(LoLProxy.logging, "exception"):
                    adapter.apply_overlay_action.side_effect = OBSOverlayError(error)
                    editor.obs_buttons["a.html"][action].invoke()
                    wait_for_request()
                    showerror.assert_called_once()
                    self.assertIn(error, showerror.call_args.args[1])
                    self.assertTrue(editor.obs_active)
                    self.assertEqual(editor.obs_state, expected)
                    self.assertFalse(editor.obs_buttons["a.html"][enabled_action].instate(["disabled"]))
            self.assertEqual(adapter.apply_overlay_action.call_args.args[3], (640, 240))
            save_port.assert_called_once()
            save_password.assert_called_once()
            confirm_save.assert_called_once()
            editor.toggle_obs_connection()
            self.assertEqual(editor.obs_password.get(), "")
            self.assertTrue(editor.obs_buttons["a.html"]["hide"].instate(["disabled"]))
            editor.obs_password.set("wrong")
            context.__enter__.side_effect = ValueError("OBS unavailable")
            with patch.object(LoLProxy.messagebox, "showerror") as showerror, \
                 patch.object(LoLProxy.logging, "exception"):
                editor.toggle_obs_connection()
                wait_for_request()
            showerror.assert_called_once()
            self.assertFalse(editor.obs_active)
            self.assertFalse(editor.obs_port_entry.instate(["disabled"]))
            save_port.assert_called_once()
            save_password.assert_called_once()
            confirm_save.assert_called_once()
            editor.obs_port.set("0")
            with patch.object(LoLProxy.messagebox, "showerror") as showerror:
                editor.toggle_obs_connection()
            showerror.assert_called_once()
            save_port.assert_called_once()
            confirm_save.assert_called_once()


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

    def test_check_reports_file_differences_without_downloading_them(self):
        self.patch_update_settings()
        requests_seen = []

        def fake_get(url, **_kwargs):
            requests_seen.append(url)
            return self.response_for(url)

        with patch.object(LoLProxy.requests, "get", side_effect=fake_get):
            update_available = LoLProxy.check_overlay_updates(self.install_root.name)
            target_path = os.path.join(self.install_root.name, *self.path.split("/"))
            os.makedirs(os.path.dirname(target_path), exist_ok=True)
            with open(target_path, "wb") as target_file:
                target_file.write(self.expected_content)
            up_to_date = LoLProxy.check_overlay_updates(self.install_root.name)

        self.assertEqual(
            update_available,
            {"version": self.version, "available_files": 1},
        )
        self.assertEqual(
            up_to_date,
            {"version": self.version, "available_files": 0},
        )
        self.assertEqual(requests_seen, [self.manifest_url, self.manifest_url])

    def test_changed_css_is_backed_up_before_confirmation_and_update(self):
        self.patch_update_settings()
        relative_path = "css/LoLOverlay.css"
        original_content = b"/* local customization */"
        self.manifest["files"] = [{
            "path": relative_path,
            "size": len(self.expected_content),
            "sha256": hashlib.sha256(self.expected_content).hexdigest(),
        }]
        target_path = os.path.join(self.install_root.name, *relative_path.split("/"))
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "wb") as target_file:
            target_file.write(original_content)

        def fake_get(url, **_kwargs):
            return self.response_for(url, self.expected_content)

        with patch.object(LoLProxy.requests, "get", side_effect=fake_get):
            prepared_update = LoLProxy.prepare_overlay_update(self.install_root.name)
            with open(target_path, "rb") as target_file:
                self.assertEqual(target_file.read(), original_content)

            backup_path = os.path.join(
                prepared_update["css_backup_directory"],
                *relative_path.split("/"),
            )
            with open(backup_path, "rb") as backup_file:
                self.assertEqual(backup_file.read(), original_content)
            self.assertTrue(
                os.path.isfile(
                    os.path.join(
                        self.install_root.name,
                        "css",
                        "custom",
                        "LoLOverlay.custom.css",
                    )
                )
            )

            result = LoLProxy.update_overlay_files(
                prepared_update=prepared_update
            )

        with open(target_path, "rb") as target_file:
            self.assertEqual(target_file.read(), self.expected_content)
        self.assertEqual(result["updated_files"], 1)
        self.assertEqual(
            result["css_backup_directory"],
            prepared_update["css_backup_directory"],
        )

    def test_update_aborts_if_css_changes_after_backup(self):
        self.patch_update_settings()
        relative_path = "css/LoLOverlay.css"
        self.manifest["files"] = [{
            "path": relative_path,
            "size": len(self.expected_content),
            "sha256": hashlib.sha256(self.expected_content).hexdigest(),
        }]
        target_path = os.path.join(self.install_root.name, *relative_path.split("/"))
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        with open(target_path, "wb") as target_file:
            target_file.write(b"original")

        with patch.object(
            LoLProxy.requests,
            "get",
            side_effect=lambda url, **_kwargs: self.response_for(
                url, self.expected_content
            ),
        ):
            prepared_update = LoLProxy.prepare_overlay_update(self.install_root.name)
            with open(target_path, "wb") as target_file:
                target_file.write(b"edited after backup")

            with self.assertRaises(LoLProxy.OverlayUpdateError):
                LoLProxy.update_overlay_files(prepared_update=prepared_update)

        with open(target_path, "rb") as target_file:
            self.assertEqual(target_file.read(), b"edited after backup")

    def test_custom_css_is_rejected_by_manifest_and_not_overwritten(self):
        self.patch_update_settings()
        custom_manifest = {
            "schema": 1,
            "version": self.version,
            "files": [{
                "path": "css/custom/LoLOverlay.custom.css",
                "size": 1,
                "sha256": "0" * 64,
            }],
        }
        with self.assertRaises(LoLProxy.OverlayUpdateError):
            LoLProxy.validate_overlay_update_manifest(custom_manifest)

        self.manifest["files"] = [{
            "path": "css/LoLOverlay.css",
            "size": len(self.expected_content),
            "sha256": hashlib.sha256(self.expected_content).hexdigest(),
        }]
        custom_path = os.path.join(
            self.install_root.name,
            "css",
            "custom",
            "LoLOverlay.custom.css",
        )
        os.makedirs(os.path.dirname(custom_path), exist_ok=True)
        custom_content = b":root { --theme-accent: hotpink; }"
        with open(custom_path, "wb") as custom_file:
            custom_file.write(custom_content)

        with patch.object(
            LoLProxy.requests,
            "get",
            side_effect=lambda url, **_kwargs: self.response_for(
                url, self.expected_content
            ),
        ):
            LoLProxy.update_overlay_files()

        with open(custom_path, "rb") as custom_file:
            self.assertEqual(custom_file.read(), custom_content)

    def test_release_check_compares_the_running_executable_sha256(self):
        executable_path = os.path.join(self.install_root.name, "LoLAPIGet.exe")
        current_binary = b"current executable"
        latest_binary = b"latest executable"
        with open(executable_path, "wb") as executable_file:
            executable_file.write(current_binary)
        latest_release = {
            "schema": 1,
            "version": "v0.7.0",
            "commit_sha": "b" * 40,
            "sha256": hashlib.sha256(latest_binary).hexdigest(),
            "release_url": (
                f"{LoLProxy.GITHUB_RELEASES_URL}/tag/v0.7.0"
            ),
        }
        with patch.object(
            LoLProxy.requests,
            "get",
            return_value=FakeResponse(b"{}", json_data=latest_release),
        ) as get:
            result = LoLProxy.check_application_release_update(
                "v0.6.0",
                "a" * 40,
                executable_path,
            )
            with open(executable_path, "wb") as executable_file:
                executable_file.write(latest_binary)
            current_result = LoLProxy.check_application_release_update(
                "v0.7.0",
                "b" * 40,
                executable_path,
            )

        self.assertTrue(result["update_available"])
        self.assertFalse(current_result["update_available"])
        self.assertEqual(
            result["release_url"],
            f"{LoLProxy.GITHUB_RELEASES_URL}/tag/v0.7.0",
        )
        self.assertFalse(result["source_commit_matches"])
        self.assertEqual(get.call_count, 2)

    def test_release_check_skips_development_builds(self):
        with patch.object(LoLProxy.requests, "get") as get:
            result = LoLProxy.check_application_release_update("開発版")

        self.assertEqual(
            result,
            {"supported": False, "tag_name": None, "update_available": False},
        )
        get.assert_not_called()

    def test_reads_version_from_frozen_build_metadata(self):
        version_path = os.path.join(self.install_root.name, "app_version.json")
        with open(version_path, "w", encoding="utf-8") as version_file:
            json.dump(
                {"version": "v0.6.0", "commit_sha": "a" * 40},
                version_file,
            )

        with patch.object(LoLProxy.sys, "frozen", True, create=True), patch.object(
            LoLProxy, "APP_VERSION_INFO_PATH", version_path
        ):
            version = LoLProxy.load_application_version()
            commit_sha = LoLProxy.load_application_commit_sha()

        self.assertEqual(version, "v0.6.0")
        self.assertEqual(commit_sha, "a" * 40)

    def test_build_manifest_contains_executable_hash_and_removes_dev_stale_file(self):
        executable_path = os.path.join(self.install_root.name, "LoLAPIGet.exe")
        version_path = os.path.join(self.install_root.name, "app_version.json")
        manifest_path = os.path.join(self.install_root.name, "app-update.json")
        script_path = os.path.join(
            os.path.dirname(LoLProxy.__file__),
            "scripts",
            "write_app_update_manifest.py",
        )
        executable = b"release executable"
        commit_sha = "c" * 40
        with open(executable_path, "wb") as executable_file:
            executable_file.write(executable)
        with open(version_path, "w", encoding="utf-8") as version_file:
            json.dump(
                {"version": "v1.2.3", "commit_sha": commit_sha},
                version_file,
            )

        subprocess.run(
            [
                sys.executable,
                script_path,
                executable_path,
                version_path,
                manifest_path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        with open(manifest_path, encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        self.assertEqual(manifest["commit_sha"], commit_sha)
        self.assertEqual(manifest["sha256"], hashlib.sha256(executable).hexdigest())
        self.assertEqual(
            manifest["release_url"],
            f"{LoLProxy.GITHUB_RELEASES_URL}/tag/v1.2.3",
        )

        with open(version_path, "w", encoding="utf-8") as version_file:
            json.dump({"version": "開発版", "commit_sha": commit_sha}, version_file)
        subprocess.run(
            [
                sys.executable,
                script_path,
                executable_path,
                version_path,
                manifest_path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertFalse(os.path.exists(manifest_path))

    def test_pages_manifest_fetch_copies_the_valid_latest_release_asset(self):
        script_path = os.path.join(
            os.path.dirname(LoLProxy.__file__),
            "scripts",
            "fetch_latest_app_update_manifest.py",
        )
        fetcher_spec = importlib.util.spec_from_file_location(
            "app_update_fetcher",
            script_path,
        )
        if fetcher_spec is None or fetcher_spec.loader is None:
            self.fail("Could not load the app update fetcher module.")
        fetcher = importlib.util.module_from_spec(fetcher_spec)
        fetcher_spec.loader.exec_module(fetcher)
        version = "v1.2.3"
        release_url = f"{LoLProxy.GITHUB_RELEASES_URL}/tag/{version}"
        asset_url = (
            f"{LoLProxy.GITHUB_RELEASES_URL}/download/{version}/app-update.json"
        )
        release = {
            "tag_name": version,
            "html_url": release_url,
            "assets": [{
                "name": "app-update.json",
                "browser_download_url": asset_url,
            }],
        }
        manifest = {
            "schema": 1,
            "version": version,
            "commit_sha": "d" * 40,
            "sha256": "e" * 64,
            "release_url": release_url,
        }

        def fake_fetch_url(url, token=None, accept=None):
            del token, accept
            if url == f"{fetcher.API_ROOT}/releases/latest":
                return json.dumps(release).encode("utf-8")
            if url == asset_url:
                return json.dumps(manifest).encode("utf-8")
            self.fail(f"Unexpected URL: {url}")

        output_path = os.path.join(self.install_root.name, "app-update.json")
        with patch.object(fetcher, "fetch_url", side_effect=fake_fetch_url), patch.dict(
            os.environ,
            {
                "GH_TOKEN": "test-token",
                "REQUIRE_APP_UPDATE_MANIFEST": "true",
                "EXPECTED_RELEASE_TAG": version,
                "EXPECTED_RELEASE_COMMIT": manifest["commit_sha"],
            },
        ), patch.object(
            sys, "argv", [script_path, output_path]
        ):
            fetcher.main()

        with open(output_path, encoding="utf-8") as manifest_file:
            self.assertEqual(json.load(manifest_file), manifest)

        for expected_tag, expected_commit in (
            ("v1.2.2", manifest["commit_sha"]),
            (version, "a" * 40),
            ("", manifest["commit_sha"]),
            (version, ""),
        ):
            with self.subTest(tag=expected_tag, commit=expected_commit):
                invalid_output = os.path.join(self.install_root.name, "invalid.json")
                with patch.object(fetcher, "fetch_url", side_effect=fake_fetch_url), patch.dict(
                    os.environ,
                    {
                        "GH_TOKEN": "test-token",
                        "REQUIRE_APP_UPDATE_MANIFEST": "true",
                        "EXPECTED_RELEASE_TAG": expected_tag,
                        "EXPECTED_RELEASE_COMMIT": expected_commit,
                    },
                ), patch.object(sys, "argv", [script_path, invalid_output]):
                    with self.assertRaises(ValueError):
                        fetcher.main()
                self.assertFalse(os.path.exists(invalid_output))

        with patch.object(fetcher, "fetch_url", side_effect=fake_fetch_url), patch.dict(
            os.environ,
            {
                "GH_TOKEN": "test-token",
                "REQUIRE_APP_UPDATE_MANIFEST": "false",
                "EXPECTED_RELEASE_TAG": "",
                "EXPECTED_RELEASE_COMMIT": "a" * 40,
            },
        ), patch.object(sys, "argv", [script_path, output_path]):
            fetcher.main()
        with open(output_path, encoding="utf-8") as manifest_file:
            self.assertEqual(json.load(manifest_file), manifest)

    def test_development_environment_uses_marker_next_to_application(self):
        marker_path = os.path.join(
            self.install_root.name,
            LoLProxy.DEVELOPMENT_MARKER_FILENAME,
        )
        with patch.object(LoLProxy, "APP_DIR", self.install_root.name):
            self.assertFalse(LoLProxy.is_development_environment())
            with open(marker_path, "w", encoding="utf-8"):
                pass
            self.assertTrue(LoLProxy.is_development_environment())

    def test_development_marker_disables_update_checks(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.overlay_update_status = FakeVariable()
        editor.overlay_update_button = FakeButton()
        editor.application_release_status = FakeVariable()
        editor.release_page_button = FakeButton()
        editor.data_dragon_update_status = FakeVariable()
        editor.data_dragon_update_button = FakeButton()

        with patch.object(
            LoLProxy, "is_development_environment", return_value=True
        ), patch.object(LoLProxy.threading, "Thread") as thread:
            editor.start_update_checks()

        thread.assert_called_once()
        self.assertEqual(
            thread.call_args.kwargs["target"].__name__,
            "run_data_dragon_update_check",
        )
        self.assertEqual(editor.overlay_update_button.last_state, ["disabled"])
        self.assertIn("開発環境", editor.overlay_update_status.value)
        self.assertEqual(editor.release_page_button.last_state, ["disabled"])
        self.assertIn("開発環境", editor.application_release_status.value)

    def test_development_marker_prevents_manual_overlay_update(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.overlay_update_in_progress = False
        editor.overlay_update_status = FakeVariable()
        editor.overlay_update_button = FakeButton()

        with patch.object(
            LoLProxy, "is_development_environment", return_value=True
        ), patch.object(LoLProxy.threading, "Thread") as thread:
            editor.start_overlay_update()

        thread.assert_not_called()
        self.assertEqual(editor.overlay_update_button.last_state, ["disabled"])
        self.assertIn("開発環境", editor.overlay_update_status.value)

    def test_startup_check_controls_overlay_button_and_release_notice(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.overlay_update_status = FakeVariable()
        editor.overlay_update_button = FakeButton()
        editor.application_release_status = FakeVariable()
        editor.release_page_button = FakeButton()

        editor.finish_overlay_update_check(
            {"version": self.version, "available_files": 0},
            None,
        )
        self.assertEqual(editor.overlay_update_button.last_state, ["disabled"])
        self.assertIn("最新", editor.overlay_update_status.value)

        editor.finish_overlay_update_check(
            {"version": self.version, "available_files": 2},
            None,
        )
        self.assertEqual(editor.overlay_update_button.last_state, ["!disabled"])

        editor.finish_application_release_check(
            {
                "supported": True,
                "tag_name": "v0.7.0",
                "update_available": True,
                "release_url": f"{LoLProxy.GITHUB_RELEASES_URL}/tag/v0.7.0",
            },
            None,
        )
        self.assertEqual(editor.release_page_button.last_state, ["!disabled"])
        self.assertIn("v0.7.0", editor.application_release_status.value)
        self.assertEqual(
            editor.application_release_url,
            f"{LoLProxy.GITHUB_RELEASES_URL}/tag/v0.7.0",
        )

    def test_canceling_css_update_keeps_backup_and_aborts_update(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = object()
        editor.overlay_update_in_progress = True
        editor.overlay_update_status = FakeVariable()
        editor.overlay_update_button = FakeButton()
        backup_directory = os.path.join(self.install_root.name, ".overlay-css-backup-test")
        prepared_update = {
            "version": self.version,
            "files_to_update": [{"path": "css/LoLOverlay.css"}],
            "css_backup_directory": backup_directory,
            "css_backup_files": ["css/LoLOverlay.css"],
        }

        with patch.object(
            LoLProxy.messagebox,
            "askyesno",
            return_value=False,
        ) as ask, patch.object(LoLProxy.threading, "Thread") as thread:
            editor.confirm_overlay_update(prepared_update, None)

        self.assertFalse(editor.overlay_update_in_progress)
        self.assertEqual(editor.overlay_update_button.last_state, ["!disabled"])
        self.assertIn("キャンセル", editor.overlay_update_status.value)
        self.assertIn(backup_directory, ask.call_args[0][1])
        thread.assert_not_called()

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


class DataDragonUpdateTests(unittest.TestCase):
    def setUp(self):
        self.install_root = tempfile.TemporaryDirectory()
        self.addCleanup(self.install_root.cleanup)
        self.version = "16.23.1"
        self.versions_url = "https://updates.example.test/versions.json"
        self.archive_url = "https://updates.example.test/dragontail-16.23.1.tgz"
        self.json_root = os.path.join(self.install_root.name, "json")
        self.config_path = os.path.join(
            self.install_root.name,
            "config",
            "data_dragon_assets.json",
        )
        os.makedirs(os.path.dirname(self.config_path))
        with open(LoLProxy.DATA_DRAGON_ASSET_CONFIG_PATH, encoding="utf-8") as source:
            self.config = json.load(source)
        with open(self.config_path, "w", encoding="utf-8") as config_file:
            json.dump(self.config, config_file)
        self.archive_content = self.create_archive()

        for name, value in (
            ("APP_DIR", self.install_root.name),
            ("JSON_DIR", self.json_root),
            ("DATA_DRAGON_ASSET_CONFIG_PATH", self.config_path),
            ("DATA_DRAGON_VERSION_PATH", os.path.join(self.install_root.name, ".ddragon-version")),
            ("DATA_DRAGON_VERSIONS_URL", self.versions_url),
            ("DATA_DRAGON_ARCHIVE_URL", "https://updates.example.test/dragontail-{version}.tgz"),
        ):
            patcher = patch.object(LoLProxy, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def create_archive(self):
        archive_buffer = io.BytesIO()
        with tarfile.open(fileobj=archive_buffer, mode="w:gz") as archive:
            for index, mapping in enumerate(self.config["directories"]):
                archive_root = self.config["archive_roots"][
                    mapping["source_root"]
                ].replace("{version}", self.version)
                archive_path = posixpath.join(
                    archive_root,
                    mapping["source"],
                    f"sample_{index}.bin",
                )
                contents = f"updated-{index}".encode("ascii")
                member = tarfile.TarInfo(archive_path)
                member.size = len(contents)
                archive.addfile(member, io.BytesIO(contents))
        return archive_buffer.getvalue()

    def fake_get(self, url, **_kwargs):
        if url == self.versions_url:
            return FakeResponse(
                b"[]",
                json_data=[self.version, "16.22.1"],
            )
        if url == self.archive_url:
            return FakeResponse(self.archive_content)
        raise AssertionError(f"Unexpected URL: {url}")

    def test_update_check_compares_installed_and_latest_data_dragon_versions(self):
        with patch.object(
            LoLProxy,
            "get_installed_data_dragon_version",
            return_value="16.22.1",
        ), patch.object(
            LoLProxy,
            "fetch_latest_data_dragon_version",
            return_value="16.23.1",
        ):
            result = LoLProxy.check_data_dragon_update()

        self.assertEqual(result["installed_version"], "16.22.1")
        self.assertEqual(result["latest_version"], "16.23.1")
        self.assertTrue(result["update_available"])

        for mapping in self.config["directories"]:
            directory = os.path.join(self.install_root.name, "assets", mapping["destination"])
            os.makedirs(directory)
            with open(os.path.join(directory, "sample.bin"), "wb") as file:
                file.write(b"asset")

        with patch.object(
            LoLProxy,
            "get_installed_data_dragon_version",
            return_value="16.23.1",
        ), patch.object(
            LoLProxy,
            "fetch_latest_data_dragon_version",
            return_value="16.23.1",
        ):
            result = LoLProxy.check_data_dragon_update()
        self.assertFalse(result["update_available"])

    def test_missing_centered_assets_allow_updating_the_same_version(self):
        for mapping in self.config["directories"]:
            if mapping["destination"] == "centered":
                continue
            directory = os.path.join(self.install_root.name, "assets", mapping["destination"])
            os.makedirs(directory)
            with open(os.path.join(directory, "sample.bin"), "wb") as file:
                file.write(b"asset")
        with patch.object(
            LoLProxy, "get_installed_data_dragon_version", return_value=self.version
        ), patch.object(
            LoLProxy, "fetch_latest_data_dragon_version", return_value=self.version
        ):
            result = LoLProxy.check_data_dragon_update()
            os.makedirs(os.path.join(self.install_root.name, "assets", "centered"))
            empty_result = LoLProxy.check_data_dragon_update()
        self.assertTrue(result["update_available"])
        self.assertEqual(result["missing_asset_directories"], ["centered"])
        self.assertTrue(empty_result["update_available"])
        self.assertEqual(empty_result["missing_asset_directories"], ["centered"])

        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.data_dragon_update_button = FakeButton()
        editor.data_dragon_update_status = FakeVariable()
        editor.finish_data_dragon_update_check(result, None)
        self.assertEqual(editor.data_dragon_update_button.last_state, ["!disabled"])
        self.assertIn("centered", editor.data_dragon_update_status.value)

    def test_missing_assets_do_not_allow_downgrading_a_newer_version(self):
        with patch.object(
            LoLProxy, "get_installed_data_dragon_version", return_value="16.24.1"
        ), patch.object(
            LoLProxy, "fetch_latest_data_dragon_version", return_value=self.version
        ):
            result = LoLProxy.check_data_dragon_update()
        self.assertFalse(result["update_available"])
        self.assertIn("centered", result["missing_asset_directories"])

        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.data_dragon_update_button = FakeButton()
        editor.data_dragon_update_status = FakeVariable()
        editor.finish_data_dragon_update_check(result, None)
        self.assertEqual(editor.data_dragon_update_button.last_state, ["disabled"])
        self.assertIn("centered", editor.data_dragon_update_status.value)

    def test_latest_data_dragon_version_disables_update_button(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.data_dragon_update_button = FakeButton()
        editor.data_dragon_update_status = FakeVariable()

        editor.finish_data_dragon_update_check(
            {
                "installed_version": "16.23.1",
                "latest_version": "16.23.1",
                "update_available": False,
            },
            None,
        )
        self.assertEqual(editor.data_dragon_update_button.last_state, ["disabled"])
        self.assertIn("最新版", editor.data_dragon_update_status.value)

        editor.finish_data_dragon_update_check(
            {
                "installed_version": "16.22.1",
                "latest_version": "16.23.1",
                "update_available": True,
            },
            None,
        )
        self.assertEqual(editor.data_dragon_update_button.last_state, ["!disabled"])

    def test_successful_data_dragon_update_disables_button(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.data_dragon_update_in_progress = True
        editor.data_dragon_update_button = FakeButton()
        editor.data_dragon_update_status = FakeVariable()
        editor.root = object()

        with patch.object(LoLProxy.messagebox, "showinfo"):
            editor.finish_data_dragon_update(
                {"version": "16.23.1", "installed_files": 4},
                None,
            )

        self.assertFalse(editor.data_dragon_update_in_progress)
        self.assertEqual(editor.data_dragon_update_button.last_state, ["disabled"])
        self.assertIn("最新版", editor.data_dragon_update_status.value)

    def test_updates_configured_assets_and_invalidates_only_language_caches(self):
        assets_root = os.path.join(self.install_root.name, "assets")
        champion_directory = os.path.join(assets_root, "champion")
        centered_directory = os.path.join(assets_root, "centered")
        os.makedirs(champion_directory)
        os.makedirs(centered_directory)
        with open(os.path.join(centered_directory, "custom.jpg"), "wb") as file:
            file.write(b"custom-centered")
        with open(os.path.join(champion_directory, "sample_0.bin"), "wb") as file:
            file.write(b"old-version")
        with open(os.path.join(champion_directory, "custom.png"), "wb") as file:
            file.write(b"custom")

        for language in ("ja_JP", "en_US"):
            language_directory = os.path.join(self.json_root, language)
            os.makedirs(language_directory)
            with open(os.path.join(language_directory, "item.json"), "w") as file:
                file.write("{}")
        spectator_path = os.path.join(self.json_root, "spectator_data.json")
        os.makedirs(self.json_root, exist_ok=True)
        with open(spectator_path, "w") as file:
            file.write("spectator data")

        requests_seen = []

        def fake_get_and_record(url, **kwargs):
            requests_seen.append(url)
            return self.fake_get(url, **kwargs)

        with patch.object(LoLProxy.requests, "get", side_effect=fake_get_and_record):
            result = LoLProxy.update_data_dragon_assets()

        self.assertEqual(result["version"], self.version)
        self.assertEqual(result["installed_files"], len(self.config["directories"]))
        self.assertEqual(requests_seen, [self.versions_url, self.archive_url])
        with open(os.path.join(champion_directory, "sample_0.bin"), "rb") as file:
            self.assertEqual(file.read(), b"updated-0")
        with open(os.path.join(champion_directory, "custom.png"), "rb") as file:
            self.assertEqual(file.read(), b"custom")
        centered_index = next(
            index for index, mapping in enumerate(self.config["directories"])
            if mapping == {
                "source_root": "shared",
                "source": "champion/centered",
                "destination": "centered",
            }
        )
        with open(os.path.join(centered_directory, f"sample_{centered_index}.bin"), "rb") as file:
            self.assertEqual(file.read(), f"updated-{centered_index}".encode("ascii"))
        with open(os.path.join(centered_directory, "custom.jpg"), "rb") as file:
            self.assertEqual(file.read(), b"custom-centered")
        self.assertFalse(os.path.exists(os.path.join(self.json_root, "ja_JP")))
        self.assertFalse(os.path.exists(os.path.join(self.json_root, "en_US")))
        with open(spectator_path) as file:
            self.assertEqual(file.read(), "spectator data")
        self.assertEqual(LoLProxy.get_installed_data_dragon_version(), self.version)

    def test_failed_version_persistence_rolls_back_assets_and_json_cache(self):
        assets_root = os.path.join(self.install_root.name, "assets")
        champion_directory = os.path.join(assets_root, "champion")
        os.makedirs(champion_directory)
        original_asset_path = os.path.join(champion_directory, "sample_0.bin")
        with open(original_asset_path, "wb") as file:
            file.write(b"original")
        language_directory = os.path.join(self.json_root, "ja_JP")
        os.makedirs(language_directory)
        cache_path = os.path.join(language_directory, "item.json")
        with open(cache_path, "w") as file:
            file.write("cached")

        with patch.object(LoLProxy.requests, "get", side_effect=self.fake_get), patch.object(
            LoLProxy,
            "save_data_dragon_version",
            side_effect=LoLProxy.DataDragonUpdateError("test save failure"),
        ):
            with self.assertRaises(LoLProxy.DataDragonUpdateError):
                LoLProxy.update_data_dragon_assets()

        with open(original_asset_path, "rb") as file:
            self.assertEqual(file.read(), b"original")
        with open(cache_path) as file:
            self.assertEqual(file.read(), "cached")
        self.assertFalse(os.path.exists(os.path.join(assets_root, "items", "sample_2.bin")))

    def test_json_route_uses_the_persisted_data_dragon_version(self):
        version_path = os.path.join(self.install_root.name, ".ddragon-version")
        with open(version_path, "w", encoding="utf-8") as version_file:
            version_file.write(self.version)
        response = FakeResponse(
            b'{"data":{}}',
            json_data={"data": {}},
        )
        with patch.object(LoLProxy, "get_language_code", return_value="ja_JP"), patch.object(
            LoLProxy.requests,
            "get",
            return_value=response,
        ) as get:
            with LoLProxy.app.test_request_context():
                result = LoLProxy.serve_static_json("items")

        self.assertTrue(result.get_json()["ok"])
        self.assertIn(f"/cdn/{self.version}/data/ja_JP/item.json", get.call_args[0][0])

    def test_static_and_champion_routes_share_cache_and_error_handling(self):
        response = FakeResponse(b"", json_data={"data": {"example": 1}})
        client = LoLProxy.app.test_client()
        with patch.object(LoLProxy, "get_language_code", return_value="ja_JP"), \
             patch.object(LoLProxy.requests, "get", return_value=response) as get:
            for url, cache_parts, remote_file in (
                ("/items", ("ja_JP", "item.json"), "item.json"),
                ("/champion/Ahri", ("ja_JP", "champion", "Ahri.json"), "champion/Ahri.json"),
            ):
                with self.subTest(url=url):
                    result = client.get(url)
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(result.get_json()["data"], {"data": {"example": 1}})
                    self.assertTrue(get.call_args.args[0].endswith(f"/ja_JP/{remote_file}"))
                    self.assertTrue(os.path.isfile(os.path.join(self.json_root, *cache_parts)))
                    get.reset_mock()
                    self.assertEqual(client.get(url).status_code, 200)
                    get.assert_not_called()
                    with open(os.path.join(self.json_root, *cache_parts), "w", encoding="utf-8") as cache:
                        cache.write("{")
                    self.assertEqual(client.get(url).status_code, 500)
                    get.assert_not_called()
            self.assertEqual(client.get("/champion/not-valid").status_code, 400)
            get.assert_not_called()

    def test_invalid_download_can_be_retried_without_corrupting_cache(self):
        client = LoLProxy.app.test_client()
        for url, cache_parts in (
            ("/items", ("ja_JP", "item.json")),
            ("/champion/Ahri", ("ja_JP", "champion", "Ahri.json")),
        ):
            with self.subTest(url=url):
                bad_response = FakeResponse(b"")
                bad_response.json = Mock(side_effect=ValueError("invalid JSON"))
                good_response = FakeResponse(b"", json_data={"data": {}})
                with patch.object(LoLProxy, "get_language_code", return_value="ja_JP"), \
                     patch.object(LoLProxy.requests, "get", side_effect=[bad_response, good_response]):
                    self.assertEqual(client.get(url).status_code, 500)
                    cache_path = os.path.join(self.json_root, *cache_parts)
                    self.assertFalse(os.path.exists(cache_path))
                    self.assertEqual(client.get(url).status_code, 200)
                    with open(cache_path, encoding="utf-8") as cache:
                        self.assertEqual(json.load(cache), {"data": {}})

    def test_failed_cache_write_leaves_no_partial_file(self):
        response = FakeResponse(b"", json_data={"data": {}})
        client = LoLProxy.app.test_client()
        with patch.object(LoLProxy, "get_language_code", return_value="ja_JP"), \
             patch.object(LoLProxy.requests, "get", return_value=response), \
             patch.object(LoLProxy.os, "replace", side_effect=OSError("write failed")):
            result = client.get("/champion/Ahri")
        self.assertEqual(result.status_code, 500)
        self.assertIn("write failed", result.get_json()["error"])
        self.assertEqual(os.listdir(os.path.join(self.json_root, "ja_JP", "champion")), [])

    def test_cache_directory_error_returns_json_error(self):
        with patch.object(LoLProxy, "get_language_code", return_value="ja_JP"), \
             patch.object(LoLProxy.os, "makedirs", side_effect=OSError("directory error")):
            response = LoLProxy.app.test_client().get("/items")
        self.assertEqual(response.status_code, 500)
        self.assertIn("directory error", response.get_json()["error"])

    def test_data_dragon_button_requires_confirmation_before_starting(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = object()
        editor.data_dragon_update_in_progress = False
        editor.data_dragon_update_button = FakeButton()
        editor.data_dragon_update_status = FakeVariable()

        with patch.object(
            LoLProxy.messagebox,
            "askyesno",
            return_value=True,
        ) as ask, patch.object(LoLProxy.threading, "Thread") as thread:
            editor.start_data_dragon_update()

        self.assertIn("観戦データは削除されません", ask.call_args[0][1])
        self.assertTrue(editor.data_dragon_update_in_progress)
        self.assertEqual(editor.data_dragon_update_button.last_state, ["disabled"])
        self.assertIn("確認", editor.data_dragon_update_status.value)
        thread.assert_called_once()

    def test_data_dragon_update_completion_disables_button_when_updated(self):
        editor = LoLProxy.SpectatorDataEditor.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = object()
        editor.data_dragon_update_in_progress = True
        editor.data_dragon_update_button = FakeButton()
        editor.data_dragon_update_status = FakeVariable()

        with patch.object(LoLProxy.messagebox, "showinfo") as showinfo:
            editor.finish_data_dragon_update(
                {"version": self.version, "installed_files": 6},
                None,
            )

        self.assertFalse(editor.data_dragon_update_in_progress)
        self.assertEqual(editor.data_dragon_update_button.last_state, ["disabled"])
        self.assertIn(self.version, editor.data_dragon_update_status.value)
        showinfo.assert_called_once()


if __name__ == "__main__":
    unittest.main()
