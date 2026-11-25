import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from obswebsocket.exceptions import ConnectionFailure
from scripts.OBSAdpter import (
    OBSAuthenticationError, OBSOverlayAdapter, OBSOverlayError,
    OBSOverlayWebSocket, overlay_source_url,
)


class FakeOBS:
    def __init__(self):
        self.scene = "Program"
        self.preview = "Preview"
        self.studio = False
        self.inputs = {}
        self.items = []
        self.calls = []
        self.failed_request = None

    def call(self, request):
        name, data = request.name, request.data()
        self.calls.append((name, data))
        if name == self.failed_request:
            return SimpleNamespace(status=False, datain={})
        responses = {
            "GetStudioModeEnabled": {"studioModeEnabled": self.studio},
            "GetCurrentProgramScene": {"currentProgramSceneName": self.scene},
            "GetCurrentPreviewScene": {"currentPreviewSceneName": self.preview},
            "GetInputList": {"inputs": [
                {"inputName": source, "inputKind": info["kind"]}
                for source, info in self.inputs.items()
            ]},
            "GetSceneList": {"scenes": [{"sceneName": self.scene}, {"sceneName": self.preview}]},
            "GetGroupList": {"groups": ["group"]},
            "GetSceneItemList": {"sceneItems": list(self.items)},
        }
        if name == "GetInputSettings":
            result = {"inputSettings": self.inputs[data["inputName"]]["settings"]}
        else:
            result = responses.get(name, {})
        return SimpleNamespace(status=True, datain=result)


class OBSOverlayAdapterTests(unittest.TestCase):
    def setUp(self):
        self.adapter = object.__new__(OBSOverlayAdapter)
        self.adapter.ws = FakeOBS()
        self.filename = "overlay 名.html"
        self.name = "overlay 名"

    def add_existing_source(self, url=None, items=None):
        self.adapter.ws.inputs[self.name] = {
            "kind": "browser_source",
            "settings": {"url": url or overlay_source_url(self.filename)},
        }
        self.adapter.ws.items = items or [
            {"sourceName": self.name, "sceneItemId": 10, "sceneItemEnabled": True}
        ]

    def test_create_uses_extensionless_name_url_size_and_current_scene(self):
        state = self.adapter.get_overlay_state([self.filename])
        self.adapter.apply_overlay_action("add", self.filename, state, (504, 150))
        name, data = self.adapter.ws.calls[-1]
        self.assertEqual(name, "CreateInput")
        self.assertEqual(data["sceneName"], "Program")
        self.assertEqual(data["inputName"], self.name)
        self.assertEqual(data["inputKind"], "browser_source")
        self.assertEqual(data["inputSettings"]["url"], overlay_source_url(self.filename))
        self.assertEqual((data["inputSettings"]["width"], data["inputSettings"]["height"]), (504, 150))

    def test_show_hide_and_delete_apply_to_scene_items(self):
        self.add_existing_source(items=[
            {"sourceName": self.name, "sceneItemId": 10, "sceneItemEnabled": True},
            {"sourceName": self.name, "sceneItemId": 11, "sceneItemEnabled": False},
        ])
        state = self.adapter.get_overlay_state([self.filename])
        for action in ("show", "hide", "delete"):
            self.adapter.ws.calls.clear()
            self.adapter.apply_overlay_action(action, self.filename, state, (1, 1))
            calls = [
                (name, data) for name, data in self.adapter.ws.calls
                if name in ("SetSceneItemEnabled", "RemoveSceneItem")
            ]
            self.assertEqual([data["sceneItemId"] for _, data in calls], [10, 11])
            self.assertTrue(all(data["sceneName"] == "Program" for _, data in calls))
            if action != "delete":
                self.assertTrue(all(data["sceneItemEnabled"] == (action == "show") for _, data in calls))

    def test_rejects_conflict_stale_scene_and_unmanaged_source(self):
        initial = self.adapter.get_overlay_state([self.filename])
        self.add_existing_source(url="https://example.test/")
        with self.assertRaisesRegex(OBSOverlayError, "既に存在"):
            self.adapter.apply_overlay_action("add", self.filename, initial, (1, 1))
        conflict = self.adapter.get_overlay_state([self.filename])
        self.assertTrue(conflict["overlays"][self.filename]["exists"])
        self.assertFalse(conflict["overlays"][self.filename]["managed"])
        with self.assertRaises(OBSOverlayError):
            self.adapter.apply_overlay_action("delete", self.filename, conflict, (1, 1))
        self.adapter.ws.scene = "Other"
        with self.assertRaises(OBSOverlayError):
            self.adapter.apply_overlay_action("add", self.filename, initial, (1, 1))
        self.assertFalse(any(name in ("CreateInput", "RemoveSceneItem") for name, _ in self.adapter.ws.calls))

    def test_preview_scene_and_failed_obs_request(self):
        self.adapter.ws.studio = True
        state = self.adapter.get_overlay_state([self.filename])
        self.assertEqual(state["scene"], "Preview")
        self.adapter.ws.failed_request = "CreateInput"
        with self.assertRaises(OBSOverlayError):
            self.adapter.apply_overlay_action("add", self.filename, state, (1, 1))

    def test_existing_scene_group_and_local_file_are_not_managed(self):
        self.add_existing_source()
        self.adapter.ws.inputs[self.name]["settings"]["is_local_file"] = True
        state = self.adapter.get_overlay_state([self.filename, "Program.html", "group.html"])
        for filename in (self.filename, "Program.html", "group.html"):
            self.assertTrue(state["overlays"][filename]["exists"])
            self.assertFalse(state["overlays"][filename]["managed"])

    def test_external_changes_abort_actions_with_specific_errors(self):
        for action, old_enabled, new_enabled, message in (
            ("show", False, True, "既に表示"),
            ("hide", True, False, "既に非表示"),
            ("delete", True, None, "ありません"),
        ):
            with self.subTest(action=action):
                self.adapter.ws = FakeOBS()
                self.add_existing_source(items=[
                    {"sourceName": self.name, "sceneItemId": 10, "sceneItemEnabled": old_enabled}
                ])
                previous = self.adapter.get_overlay_state([self.filename])
                if new_enabled is None:
                    self.adapter.ws.items.clear()
                else:
                    self.adapter.ws.items[0]["sceneItemEnabled"] = new_enabled
                with self.assertRaisesRegex(OBSOverlayError, message):
                    self.adapter.apply_overlay_action(action, self.filename, previous, (1, 1))
                self.assertFalse(any(
                    name in ("SetSceneItemEnabled", "RemoveSceneItem")
                    for name, _ in self.adapter.ws.calls
                ))

    def test_auth_failure_is_reported_without_hiding_other_connection_errors(self):
        for error, expected in (
            (ConnectionFailure("Empty response to Identify, password may be inconnect."), OBSAuthenticationError),
            (ConnectionFailure("Invalid Hello message."), ConnectionFailure),
        ):
            with self.subTest(error=error):
                socket = Mock()
                socket.connect.side_effect = error
                self.adapter.ws = socket
                with self.assertRaises(expected):
                    self.adapter.__enter__()
                socket.ws.close.assert_called_once()

    def test_handshake_has_timeout_and_receiver_timeout_is_cleared(self):
        client = OBSOverlayWebSocket("127.0.0.1", 4455, "test", legacy=False, timeout=5)
        with patch("scripts.OBSAdpter.WebSocket") as websocket, \
             patch.object(client, "_auth") as auth, \
             patch("scripts.OBSAdpter.RecvThread") as receiver:
            client.connect()
        websocket.return_value.connect.assert_called_once_with("ws://127.0.0.1:4455", timeout=5)
        auth.assert_called_once()
        websocket.return_value.settimeout.assert_called_once_with(None)
        receiver.return_value.start.assert_called_once()

    def test_obs_identify_close_is_reported_as_possible_auth_failure(self):
        adapter = OBSOverlayAdapter(4455, "wrong")
        with patch("scripts.OBSAdpter.WebSocket") as websocket:
            websocket.return_value.recv.side_effect = [
                '{"op":0,"d":{"obsWebSocketVersion":"5.0","authentication":'
                '{"salt":"salt","challenge":"challenge"}}}',
                "",
            ]
            with self.assertRaises(OBSAuthenticationError):
                adapter.__enter__()
            websocket.return_value.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
