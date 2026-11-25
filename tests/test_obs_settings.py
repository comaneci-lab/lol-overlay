import configparser
import os
import queue
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, call, patch

import LoLProxy
from obswebsocket.exceptions import ConnectionFailure


class CredentialError(Exception):
    def __init__(self, winerror):
        self.winerror = winerror


class FakeCredentials:
    CRED_TYPE_GENERIC = 1
    CRED_PERSIST_LOCAL_MACHINE = 2

    def __init__(self):
        self.records = {}

    def CredRead(self, TargetName, Type):
        if TargetName not in self.records:
            raise CredentialError(1168)
        return {"CredentialBlob": self.records[TargetName].encode("utf-16-le")}

    def CredWrite(self, credential, flags):
        self.records[credential["TargetName"]] = credential["CredentialBlob"]

    def CredDelete(self, target, Type, flags):
        if target not in self.records:
            raise CredentialError(1168)
        del self.records[target]


class OBSSettingsTests(unittest.TestCase):
    def test_management_headers_and_rows_align_and_match_status_background(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.geometry("1120x600")
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = root
        tab = LoLProxy.ttk.Frame(root)
        tab.pack(fill="both", expand=True)
        filenames = ["LoL_TopBar_Overlay.html", "LoL_Scoreboard_Overlay.html"]
        with patch.object(editor, "get_html_files", return_value=filenames):
            editor.create_html_view(tab)
        root.update()

        for width in (1120, 1500):
            root.geometry(f"{width}x600")
            root.update()
            for column in range(4):
                header = editor.html_rows.grid_slaves(row=0, column=column)[0]
                x, _, column_width, _ = editor.html_rows.grid_bbox(column, 0)
                header_center = header.winfo_x() + header.winfo_width() / 2
                self.assertLessEqual(abs(header_center - (x + column_width / 2)), 1)
            for index, filename in enumerate(filenames):
                row = index * 2 + 1
                item_frame = editor.html_rows.grid_slaves(row=row, column=0)[0]
                status_frame = editor.html_rows.grid_slaves(row=row, column=1)[0]
                browser_frame = editor.html_rows.grid_slaves(row=row, column=2)[0]
                self.assertEqual(status_frame.cget("style"), item_frame.cget("style"))
                self.assertEqual(browser_frame.cget("style"), item_frame.cget("style"))
                self.assertIs(editor.obs_status_labels[filename].master, status_frame)
                for label in item_frame.winfo_children():
                    self.assertEqual(label.winfo_x(), 8)

    def test_port_preserves_existing_settings_and_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "settings.ini")
            with open(path, "w", encoding="utf-8-sig") as settings:
                settings.write("[settings]\nlanguage = en_US\nspectator_mode = false\n")
            with patch.object(LoLProxy, "CONFIG_PATH", path):
                self.assertEqual(LoLProxy.load_obs_port(), 4455)
                LoLProxy.save_obs_port(4456)
                self.assertEqual(LoLProxy.load_obs_port(), 4456)
                parser = configparser.ConfigParser()
                parser.read(path, encoding="utf-8")
                self.assertEqual(parser["settings"]["language"], "en_US")
                self.assertEqual(parser["settings"]["spectator_mode"], "false")
                self.assertEqual(parser["obs"]["port"], "4456")
                self.assertNotIn("password", parser["obs"])

    def test_invalid_port_and_failed_write_do_not_overwrite_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "settings.ini")
            original = "[settings]\nlanguage = ja_JP\n[obs]\nport = invalid\n"
            with open(path, "w", encoding="utf-8") as settings:
                settings.write(original)
            with patch.object(LoLProxy, "CONFIG_PATH", path):
                with self.assertRaises(LoLProxy.OBSSettingsError):
                    LoLProxy.load_obs_port()
                with self.assertRaises(LoLProxy.OBSSettingsError):
                    LoLProxy.save_obs_port(65536)
                with patch.object(LoLProxy.os, "replace", side_effect=OSError("denied")):
                    with self.assertRaises(LoLProxy.OBSSettingsError):
                        LoLProxy.save_obs_port(4455)
                with open(path, encoding="utf-8") as settings:
                    self.assertEqual(settings.read(), original)
                self.assertEqual(os.listdir(directory), ["settings.ini"])

    def test_credential_write_replace_read_and_delete(self):
        backend = FakeCredentials()
        with patch.object(LoLProxy, "obs_credential_api", return_value=(backend, CredentialError)):
            self.assertIsNone(LoLProxy.load_obs_password())
            with self.assertRaises(LoLProxy.OBSSettingsError):
                LoLProxy.save_obs_password("")
            LoLProxy.save_obs_password("test 日本語")
            self.assertEqual(LoLProxy.load_obs_password(), "test 日本語")
            LoLProxy.save_obs_password("replacement")
            self.assertEqual(LoLProxy.load_obs_password(), "replacement")
            self.assertEqual(len(backend.records), 1)
            self.assertTrue(LoLProxy.delete_obs_password())
            self.assertIsNone(LoLProxy.load_obs_password())
            self.assertFalse(LoLProxy.delete_obs_password())

    def test_credential_errors_are_not_treated_as_missing(self):
        backend = FakeCredentials()
        with patch.object(LoLProxy, "obs_credential_api", return_value=(backend, CredentialError)):
            with patch.object(backend, "CredRead", side_effect=CredentialError(5)):
                with self.assertRaises(LoLProxy.OBSSettingsError):
                    LoLProxy.load_obs_password()
            with patch.object(backend, "CredRead", return_value={"CredentialBlob": b"\xff"}):
                with self.assertRaises(LoLProxy.OBSSettingsError):
                    LoLProxy.load_obs_password()
            with patch.object(backend, "CredWrite", side_effect=CredentialError(5)):
                with self.assertRaises(LoLProxy.OBSSettingsError):
                    LoLProxy.save_obs_password("test")
            with patch.object(backend, "CredDelete", side_effect=CredentialError(5)):
                with self.assertRaises(LoLProxy.OBSSettingsError):
                    LoLProxy.delete_obs_password()

    def test_settings_tab_loads_and_deletes_saved_password(self):
        try:
            root = LoLProxy.tk.Tk()
        except LoLProxy.tk.TclError as error:
            self.skipTest(f"Tk is unavailable: {error}")
        self.addCleanup(root.destroy)
        root.withdraw()
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = root
        editor.obs_port = LoLProxy.tk.StringVar(value="4455")
        editor.obs_password = LoLProxy.tk.StringVar()
        editor.obs_status = LoLProxy.tk.StringVar()
        tab = LoLProxy.ttk.Frame(root)
        with patch.object(LoLProxy, "load_obs_port", return_value=4456), \
             patch.object(LoLProxy, "load_obs_password", return_value="previous"), \
             patch.object(root, "after"):
            editor.create_obs_settings_view(tab)
        self.assertEqual(editor.obs_port.get(), "4456")
        self.assertEqual(editor.obs_password.get(), "previous")
        widgets = tab.winfo_children()
        widgets += [child for widget in widgets for child in widget.winfo_children()]
        self.assertFalse(any(isinstance(widget, LoLProxy.ttk.Checkbutton) for widget in widgets))
        self.assertNotIn(
            "設定を保存",
            [widget.cget("text") for widget in widgets if isinstance(widget, LoLProxy.ttk.Button)],
        )

        with patch.object(LoLProxy, "load_obs_password", side_effect=LoLProxy.OBSSettingsError("read error")), \
             patch.object(LoLProxy.messagebox, "showerror") as showerror:
            editor.load_saved_obs_password()
            showerror.assert_called_once()

        with patch.object(LoLProxy.messagebox, "askyesno", return_value=True), \
             patch.object(LoLProxy.messagebox, "showinfo"), \
             patch.object(LoLProxy, "delete_obs_password", return_value=True) as delete:
            editor.obs_password_delete_button.invoke()
            delete.assert_called_once_with()
            self.assertEqual(editor.obs_password.get(), "")
        root.update_idletasks()

    def test_connection_setting_save_confirmation_and_errors(self):
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = Mock()
        with patch.object(LoLProxy, "save_obs_port") as save_port, \
             patch.object(LoLProxy, "save_obs_password") as save_password, \
             patch.object(LoLProxy.messagebox, "askyesno") as ask, \
             patch.object(LoLProxy.messagebox, "showerror") as showerror:
            ask.return_value = True
            editor.save_connected_obs_settings(4456, "new")
            save_port.assert_called_once_with(4456)
            save_password.assert_called_once_with("new")

            save_password.reset_mock()
            ask.return_value = False
            editor.save_connected_obs_settings(4456, "new")
            save_password.assert_not_called()
            self.assertIn("保存済みのパスワードは変更されません", ask.call_args.args[1])

            ask.reset_mock()
            editor.save_connected_obs_settings(4456, "")
            ask.assert_not_called()
            save_password.assert_not_called()

            save_port.side_effect = LoLProxy.OBSSettingsError("port error")
            ask.return_value = True
            save_password.side_effect = LoLProxy.OBSSettingsError("credential error")
            editor.save_connected_obs_settings(4456, "new")
            self.assertEqual(showerror.call_count, 2)
            self.assertIn("port error", showerror.call_args_list[0].args[1])
            self.assertIn("credential error", showerror.call_args_list[1].args[1])

    def test_auto_connect_requires_valid_settings_and_saved_password(self):
        editor = object.__new__(LoLProxy.SpectatorDataEditor)
        editor.root = Mock()
        editor.obs_port = Mock()
        editor.obs_password = Mock()
        with patch.object(LoLProxy.messagebox, "showerror"), \
             patch.object(LoLProxy, "load_obs_port", return_value=4455) as port, \
             patch.object(LoLProxy, "load_obs_password", return_value="saved") as password:
            self.assertTrue(editor.load_obs_settings())
            password.return_value = None
            self.assertFalse(editor.load_obs_settings())
            password.return_value = "saved"
            port.side_effect = LoLProxy.OBSSettingsError("bad port")
            self.assertFalse(editor.load_obs_settings())
            port.side_effect = None
            password.side_effect = LoLProxy.OBSSettingsError("credential error")
            self.assertFalse(editor.load_obs_settings())


class OBSReconnectTests(unittest.TestCase):
    def setUp(self):
        self.editor = object.__new__(LoLProxy.SpectatorDataEditor)
        self.editor.root = Mock()
        self.editor.root.after.return_value = "timer"
        self.editor.obs_active = False
        self.editor.obs_busy = False
        self.editor.obs_state = None
        self.editor.obs_timer = None
        self.editor.obs_pending_settings = None
        self.editor.obs_results = queue.Queue()
        self.editor.obs_buttons = {}
        self.editor.obs_port = Mock()
        self.editor.obs_port.get.return_value = "4455"
        self.editor.obs_password = Mock()
        self.editor.obs_password.get.return_value = "saved"
        self.editor.obs_status = Mock()
        self.editor.obs_connect_button = Mock()
        self.editor.obs_password_delete_button = Mock()
        self.editor.obs_port_entry = Mock()
        self.editor.obs_password_entry = Mock()
        self.editor.html_refresh_button = Mock()
        self.start_thread = patch.object(
            LoLProxy.threading.Thread, "start", lambda thread: thread.run()
        )
        self.start_thread.start()
        self.addCleanup(self.start_thread.stop)

    def request(self, error=None, state=None, action=None):
        adapter = MagicMock()
        adapter.__enter__.return_value = adapter
        if error is not None:
            adapter.__enter__.side_effect = error
        else:
            adapter.get_overlay_state.return_value = state or {"scene": "Scene", "overlays": {}}
        with patch.object(LoLProxy, "OBSOverlayAdapter", return_value=adapter), \
             patch.object(LoLProxy.messagebox, "showerror") as showerror:
            self.editor.start_obs_request(action=action, filename="test.html", notify_error=bool(action))
            self.editor.finish_obs_request()
        return adapter, showerror

    def test_auto_retry_stops_after_success_without_save_prompt(self):
        with patch.object(self.editor, "start_obs_request") as start:
            self.editor.start_auto_obs_connection("4455", "saved")
            start.assert_called_once_with()
        with patch.object(self.editor, "save_connected_obs_settings") as save:
            for _ in range(3):
                _, showerror = self.request(ConnectionRefusedError("offline"))
                self.assertTrue(self.editor.obs_active)
                self.assertIsNone(self.editor.obs_state)
                self.assertEqual(self.editor.obs_timer, "timer")
                showerror.assert_not_called()
            self.editor.root.after.assert_any_call(
                LoLProxy.OBS_RETRY_INTERVAL_MS, self.editor.scheduled_obs_request
            )
            self.editor.root.after.reset_mock()
            self.request()
            self.assertEqual(self.editor.obs_state["scene"], "Scene")
            self.assertIsNone(self.editor.obs_timer)
            self.assertNotIn(
                call(LoLProxy.OBS_RETRY_INTERVAL_MS, self.editor.scheduled_obs_request),
                self.editor.root.after.call_args_list,
            )
            self.request(ConnectionRefusedError("stopped"))
            self.assertTrue(self.editor.obs_active)
            self.assertIsNone(self.editor.obs_state)
            self.assertEqual(self.editor.obs_timer, "timer")
            self.request()
            self.assertEqual(self.editor.obs_state["scene"], "Scene")
            self.assertIsNone(self.editor.obs_timer)
            save.assert_not_called()

    def test_auth_failure_and_unknown_errors_stop_retry(self):
        for error in (LoLProxy.OBSAuthenticationError("password"), ValueError("unexpected")):
            with self.subTest(error=error):
                self.editor.obs_active = True
                self.request(error)
                self.assertFalse(self.editor.obs_active)
                self.assertIsNone(self.editor.obs_timer)
                self.assertIn(str(error), self.editor.obs_status.set.call_args.args[0])

    def test_edit_or_disconnect_cancels_waiting_retry(self):
        self.editor.obs_active = True
        self.request(ConnectionRefusedError("offline"))
        self.editor.obs_settings_changed()
        self.assertFalse(self.editor.obs_active)
        self.editor.root.after_cancel.assert_called_with("timer")
        self.editor.obs_password.set.assert_not_called()
        self.editor.obs_active = True
        self.request(ConnectionRefusedError("offline"))
        with patch.object(self.editor, "load_saved_obs_password"):
            self.editor.toggle_obs_connection()
        self.assertFalse(self.editor.obs_active)
        self.assertIsNone(self.editor.obs_timer)

    def test_manual_connection_saves_only_after_eventual_success(self):
        with patch.object(self.editor, "save_connected_obs_settings") as save, \
             patch.object(LoLProxy, "OBSOverlayAdapter", side_effect=ConnectionRefusedError("offline")), \
             patch.object(LoLProxy.messagebox, "showerror") as showerror:
            self.editor.toggle_obs_connection()
            self.editor.finish_obs_request()
            self.assertTrue(self.editor.obs_active)
            showerror.assert_not_called()
            save.assert_not_called()
            self.request()
            save.assert_called_once_with(4455, "saved")
            self.request()
            save.assert_called_once()

    def test_stopped_inflight_result_does_not_restart_or_save(self):
        self.editor.obs_active = True
        self.editor.obs_busy = True
        self.editor.obs_pending_settings = (4455, "saved")
        self.editor.obs_results.put(({"scene": "Scene", "overlays": {}}, None, None, False, None))
        with patch.object(self.editor, "load_saved_obs_password"), \
             patch.object(self.editor, "save_connected_obs_settings") as save:
            self.editor.toggle_obs_connection()
            self.editor.finish_obs_request()
        self.assertFalse(self.editor.obs_active)
        self.assertIsNone(self.editor.obs_timer)
        save.assert_not_called()

    def test_failed_action_not_replayed_when_connection_returns(self):
        self.editor.obs_active = True
        self.editor.obs_state = {"scene": "Scene", "overlays": {}}
        adapter, showerror = self.request(ConnectionRefusedError("offline"), action="delete")
        showerror.assert_called_once()
        adapter.apply_overlay_action.assert_not_called()
        adapter, _ = self.request()
        adapter.apply_overlay_action.assert_not_called()

    def test_partially_failed_action_is_reported_and_not_replayed(self):
        self.editor.obs_active = True
        self.editor.obs_state = {"scene": "Scene", "overlays": {}}
        adapter = MagicMock()
        adapter.__enter__.return_value = adapter
        adapter.apply_overlay_action.side_effect = RuntimeError("partial")
        adapter.get_overlay_state.side_effect = ConnectionRefusedError("offline")
        with patch.object(LoLProxy, "OBSOverlayAdapter", return_value=adapter), \
             patch.object(LoLProxy.messagebox, "showerror") as showerror:
            self.editor.start_obs_request(action="delete", filename="test.html", notify_error=True)
            self.editor.finish_obs_request()
        self.assertTrue(self.editor.obs_active)
        self.assertIn("一部反映", showerror.call_args.args[1])
        adapter, _ = self.request()
        adapter.apply_overlay_action.assert_not_called()

    def test_auto_start_skips_changed_settings(self):
        with patch.object(self.editor, "start_obs_request") as start:
            self.editor.start_auto_obs_connection("4456", "saved")
            self.assertFalse(self.editor.obs_active)
            start.assert_not_called()

    def test_error_classification(self):
        self.assertTrue(LoLProxy.is_retryable_obs_error(ConnectionRefusedError()))
        self.assertTrue(LoLProxy.is_retryable_obs_error(LoLProxy.MessageTimeout()))
        self.assertFalse(LoLProxy.is_retryable_obs_error(ConnectionFailure("bad protocol")))
        self.assertFalse(LoLProxy.is_retryable_obs_error(LoLProxy.OBSAuthenticationError()))


if __name__ == "__main__":
    unittest.main()
