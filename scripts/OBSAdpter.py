from obswebsocket import obsws, requests as obs_req
from obswebsocket.core import RecvThread
from obswebsocket.exceptions import ConnectionFailure
from websocket import WebSocket
import logging
import asyncio
import time
import os
from urllib.parse import quote

class OBSAdpter:
    def __init__(self, host, port, password,scene_name):
        # OBSに接続
        try:
            self.ws = obsws(host, port, password)
            self.ws.connect()  # WebSocket接続を開始
            print("OBSに接続しました！",flush=True)
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"OBSへの接続に失敗しました: {e}",flush=True)
            self.ws = None
        
        self.all_item_id = self.GetAllSceneItems(scene_name)

    def disconnect(self):
        try:
            self.ws.disconnect()
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"OBSの切断に失敗しました: {e}",flush=True)   

    def call(self, request):
        return self.ws.call(request)
    ## OBS関数

    def deleteSceneItem(self,scene_name, scene_item_id):
        try:
            self.ws.call(obs_req.RemoveSceneItem(sceneName=scene_name,sceneItemId=scene_item_id))
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"シーンアイテムの削除に失敗しました: {e}",flush=True)
        

    def ClipReplay(self,game_scene_name,clip_item_id,movie_file_path):

        self.ws.call(obs_req.SetInputSettings(inputName='clip',inputSettings={"local_file":movie_file_path},overlay=True))
        self.SetSceneItemEnabled(game_scene_name,clip_item_id,True)

    async def SaveReplay(self):
        try:
            self.ws.call(obs_req.SaveReplayBuffer())
            return True
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"録画の保存に失敗しました: {e}",flush=True)
            return False

    async def DelayedSave(self, clip_delay):
        await asyncio.sleep(clip_delay)
        return await self.SaveReplay()

    # OBSWebsocketのアイテムIDを取得する関数
    # scene_name: シーン名, source_name: ソース名
    def GetObsItemId(self,scene_name, source_name):
        try:
            #item_id = self.ws.call(obs_req.GetSceneItemId(sceneName=scene_name,sourceName=source_name)).datain['sceneItemId']
            item_id = next(
                (item["sceneItemId"] for item in self.all_item_id if item["sourceName"] == source_name)
                ,None
            )

            # all_item_idに存在しない場合、再取得を試みる
            if item_id is None:
                item_id = self.ws.call(obs_req.GetSceneItemId(sceneName=scene_name,sourceName=source_name))
            
            # OBS上にアイテムが存在するか確認
            if item_id.status:
                return item_id.datain['sceneItemId']
            else:
                return None

        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"SceneItemID({source_name})の取得に失敗しました。{e}")

    # OBSWebsocketのアイテムを有効化する関数
    def SetSceneItemEnabled(self,scene_name, item_id, enabled):
        self.ws.call(obs_req.SetSceneItemEnabled(sceneName=scene_name, sceneItemId=item_id, sceneItemEnabled=enabled))

    def SetInputSettings(self,input_name, text):
        self.ws.call(obs_req.SetInputSettings(inputName=input_name, inputSettings=text, overlay=True))

    def StartRecord(self):

        try:
            self.ws.call(obs_req.StartRecord())
            #print("録画を開始しました。",flush=True)
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            #print(f"録画の開始に失敗しました: {e}",flush=True)

    def StopRecord(self):

        # OBS録画状態の取得
        record_status = self.ws.call(obs_req.GetRecordStatus())

        if record_status.datain['outputActive']:
            try:
                filename=self.ws.call(obs_req.StopRecord())
                print("録画を停止しました。",flush=True)
                
                time.sleep(5)  # ファイルが完全に保存されるまで少し待つ
                return filename.datain['outputPath']
            except Exception as e:
                logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
                print(f"録画の停止に失敗しました: {e}",flush=True)
        else:
            print("録画は既に停止しています。",flush=True)
    
    def StartReplayBuffer(self):
        # OBSリプレイバッファ状態の取得
        replay_status = self.ws.call(obs_req.GetReplayBufferStatus())

        if replay_status.datain['outputActive']:
            print("リプレイバッファは既に開始しています。",flush=True)
        else:
            try:
                self.ws.call(obs_req.StartReplayBuffer())
                print("リプレイバッファを開始しました。",flush=True)
            except Exception as e:
                logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
                print(f"リプレイバッファの開始に失敗しました: {e}",flush=True)


    def StopReplayBuffer(self):
        # OBSリプレイバッファ状態の取得
        replay_status = self.ws.call(obs_req.GetReplayBufferStatus())

        if replay_status.datain['outputActive']:
            try:
                self.ws.call(obs_req.StopReplayBuffer())
                print("リプレイバッファを停止しました。",flush=True)
            except Exception as e:
                logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
                print(f"リプレイバッファの停止に失敗しました: {e}",flush=True)
        else:
            print("リプレイバッファは既に停止しています。",flush=True)


    def GetReplayFileName(self):
        try:
            return self.ws.call(obs_req.GetLastReplayBufferReplay())
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"リプレイファイル名の取得に失敗しました: {e}",flush=True)
            return ""

    def GetAllSceneItems(self, scene_name):
        try:
            # シーン直下のアイテムを取得
            scene_items = self.ws.call(obs_req.GetSceneItemList(sceneName=scene_name)).getSceneItems()

            # グループIDとsourceNameを抽出
            group_sources = [
                (item['sceneItemId'], item['sourceName'])
                for item in scene_items
                if item.get('isGroup') and item.get('sourceType') == 'OBS_SOURCE_TYPE_SCENE'
            ]

            # グループの中身を取得（sourceNameをシーン名として使う）
            group_items = []
            for gid, group_scene_name in group_sources:
                try:
                    sub_items = self.ws.call(obs_req.GetGroupSceneItemList(sceneName=group_scene_name)).getSceneItems()
                    group_items.extend(sub_items)
                except Exception as e:
                    print(f"グループ '{group_scene_name}' の中身取得に失敗: {e}")

            # すべてのアイテムを合体
            all_items = scene_items + group_items
            return all_items
        
        except Exception as e:
            print(f"シーンアイテムの取得に失敗しました: {e}", flush=True)
            return []
    
    def DeleteSceneItemsByPrefix(self, scene_name, prefix):
        """
        指定された scene_name 内のシーンアイテムを走査し、
        sourceName が prefix で始まるアイテムを削除する。
        戻り値: 削除したアイテムのリスト [(scene_name, sourceName, sceneItemId), ...]
        """
        deleted = []
        try:
            items = self.GetAllSceneItems(scene_name)
            for item in items:
                src = item.get('sourceName', '')
                item_id = item.get('sceneItemId')
                if not src or item_id is None:
                    continue
                if src.startswith(prefix):
                    try:
                        self.deleteSceneItem(scene_name, item_id)
                        deleted.append((scene_name, src, item_id))
                    except Exception as ex:
                        logging.error("シーンアイテムの削除に失敗しました", exc_info=True)
                        print(f"削除失敗: {scene_name} / {src} ({item_id}): {ex}", flush=True)

            print(f"DeleteSceneItemsByPrefix: 削除完了 {len(deleted)} 件 (scene='{scene_name}', prefix='{prefix}')", flush=True)
            return deleted
        except Exception as e:
            logging.error("DeleteSceneItemsByPrefix でエラー", exc_info=True)
            print(f"DeleteSceneItemsByPrefix に失敗しました: {e}", flush=True)
            return deleted

    def GetRecordStatus(self):
        try:
            return self.ws.call(obs_req.GetRecordStatus())
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"録画状態の取得に失敗しました: {e}",flush=True)
            return None
    
    def CreateSceneItem(self, scene_name, source_name,source_kind,settings):
        try:
            response = self.ws.call(obs_req.CreateInput(
                    sceneName=scene_name,
                    inputName=source_name,
                    inputKind=source_kind,
                    inputSettings=settings,
                    sceneItemEnabled=True
                    ))
            return response
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"シーンアイテムの作成に失敗しました: {e}",flush=True)
            return None
    
    def SetSceneItemTransform(self,scene_name, item_id, settings):
        try:
            self.ws.call(obs_req.SetSceneItemTransform(
                sceneName=scene_name,
                sceneItemId=item_id,
                sceneItemTransform=settings
            ))
        except Exception as e:
            logging.error("エラーが発生しました", exc_info=True)  # exc_info=Trueでトレースバックも記録
            print(f"シーンアイテムの変換設定に失敗しました: {e}",flush=True)


class OBSOverlayError(Exception):
    pass


class OBSAuthenticationError(OBSOverlayError):
    pass


class OBSOverlayWebSocket(obsws):
    def connect(self):
        # obsws.timeout normally applies only to requests, not the handshake.
        self.ws = WebSocket()
        self.ws.connect(f"ws://{self.host}:{self.port}", timeout=self.timeout)
        self._auth()
        self.ws.settimeout(None)
        self.thread_recv = RecvThread(self)
        self.thread_recv.daemon = True
        self.thread_recv.start()


def overlay_source_name(filename):
    return os.path.splitext(filename)[0]


def overlay_source_url(filename):
    return f"http://127.0.0.1:8888/html/{quote(filename, safe='')}"


class OBSOverlayAdapter(OBSAdpter):
    def __init__(self, port, password):
        self.ws = OBSOverlayWebSocket("127.0.0.1", port, password, legacy=False, timeout=5)

    def __enter__(self):
        try:
            self.ws.connect()
        except Exception as error:
            if self.ws.ws is not None:
                self.ws.ws.close()
            if isinstance(error, ConnectionFailure) and str(error) == (
                "Empty response to Identify, password may be inconnect."
            ):
                raise OBSAuthenticationError(
                    "OBS認証に失敗した可能性があります。パスワードを確認してください。"
                ) from error
            raise
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        self.ws.disconnect()

    def checked_call(self, request):
        response = self.call(request)
        if not response.status:
            raise OBSOverlayError(f"OBSの操作に失敗しました: {request.name}")
        return response.datain

    def get_overlay_state(self, filenames):
        studio = self.checked_call(obs_req.GetStudioModeEnabled())["studioModeEnabled"]
        if studio:
            scene = self.checked_call(obs_req.GetCurrentPreviewScene())["currentPreviewSceneName"]
        else:
            scene = self.checked_call(obs_req.GetCurrentProgramScene())["currentProgramSceneName"]
        inputs = self.checked_call(obs_req.GetInputList())["inputs"]
        scene_names = {
            entry["sceneName"]
            for entry in self.checked_call(obs_req.GetSceneList())["scenes"]
        }
        group_names = set(self.checked_call(obs_req.GetGroupList())["groups"])
        inputs_by_name = {item["inputName"]: item for item in inputs}
        existing_names = set(inputs_by_name) | scene_names | group_names
        scene_items = self.checked_call(obs_req.GetSceneItemList(sceneName=scene))["sceneItems"]
        overlays = {}
        for filename in filenames:
            name = overlay_source_name(filename)
            source = inputs_by_name.get(name)
            managed = False
            if source and source["inputKind"] == "browser_source":
                settings = self.checked_call(obs_req.GetInputSettings(inputName=name))
                input_settings = settings["inputSettings"]
                managed = (
                    not input_settings.get("is_local_file", False)
                    and input_settings.get("url") == overlay_source_url(filename)
                )
            items = [
                (item["sceneItemId"], item["sceneItemEnabled"])
                for item in scene_items
                if managed and item["sourceName"] == name
            ]
            overlays[filename] = {
                "exists": name in existing_names,
                "managed": managed,
                "items": items,
            }
        return {"scene": scene, "overlays": overlays}

    def apply_overlay_action(self, action, filename, expected_state, dimensions):
        state = self.get_overlay_state([filename])
        if state["scene"] != expected_state["scene"]:
            raise OBSOverlayError("OBSのシーンが変更されたため操作を中止しました。")
        current = state["overlays"][filename]
        previous = expected_state["overlays"][filename]
        if action == "add" and current["exists"]:
            raise OBSOverlayError("同名のソースが既に存在します。")
        if action in ("show", "hide", "delete"):
            if not current["managed"] or not current["items"]:
                raise OBSOverlayError("対象シーンに操作可能なソースがありません。")
            if action == "show" and all(enabled for _, enabled in current["items"]):
                raise OBSOverlayError("ソースは既に表示されています。")
            if action == "hide" and all(not enabled for _, enabled in current["items"]):
                raise OBSOverlayError("ソースは既に非表示です。")
        if current != previous:
            raise OBSOverlayError("OBSのソース状態が変更されたため操作を中止しました。")
        name = overlay_source_name(filename)
        if action == "add":
            width, height = dimensions
            self.checked_call(obs_req.CreateInput(
                sceneName=state["scene"],
                inputName=name,
                inputKind="browser_source",
                inputSettings={
                    "url": overlay_source_url(filename),
                    "is_local_file": False,
                    "width": width,
                    "height": height,
                    "shutdown": True,
                    "restart_when_active": True,
                },
                sceneItemEnabled=True,
            ))
        elif action in ("show", "hide", "delete"):
            for item_id, _enabled in current["items"]:
                if action == "delete":
                    request = obs_req.RemoveSceneItem(
                        sceneName=state["scene"], sceneItemId=item_id
                    )
                else:
                    request = obs_req.SetSceneItemEnabled(
                        sceneName=state["scene"],
                        sceneItemId=item_id,
                        sceneItemEnabled=action == "show",
                    )
                self.checked_call(request)
        else:
            raise OBSOverlayError(f"不明なOBS操作です: {action}")