from copy import deepcopy
from flask import Flask, jsonify, send_from_directory
import configparser
import json
import os
import requests
import sys
import threading
import tkinter as tk
from tkinter import messagebox, ttk
import urllib3
from werkzeug.serving import make_server

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
session = requests.Session()

BASE            = "https://127.0.0.1:2999/liveclientdata"
APP_DIR         = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
RESOURCE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
JSON_DIR        = os.path.join(APP_DIR, "json")
CONFIG_PATH = os.path.join(APP_DIR, "settings.ini")
SPECTATOR_DATA_PATH = os.path.join(JSON_DIR, "spectator_data.json")
LEGACY_SPECTATOR_DATA_PATH = os.path.join(APP_DIR, "spectator_data.json")
DEFAULT_LANGUAGE = "ja_JP"
DATA_DRAGON_VERSION = "16.4.1"
TEAMS = ("ORDER", "CHAOS")
OBJECTIVE_FIELDS = {
    "HordeKill": "ヴォイドグラブ",
    "HeraldKill": "ヘラルド",
    "DragonKill": "ドラゴン",
    "BaronKill": "バロン",
}
DRAGON_TYPES = {"Air", "Earth", "Fire", "Water", "Chemtech", "Hextech", "Elder"}
DRAGON_BUTTONS = (
    ("Chemtech", "ケミテック", "dragon_chemtech.png"),
    ("Air", "クラウド", "dragon_cloud.png"),
    ("Hextech", "ヘクステック", "dragon_hextech.png"),
    ("Fire", "インファーナル", "dragon_infernal.png"),
    ("Earth", "マウンテン", "dragon_mountain.png"),
    ("Water", "オーシャン", "dragon_ocean.png"),
    ("Elder", "エルダー", "dragon_elder.png"),
)
SUPPORTED_LANGUAGES = {
    "cs_CZ", "el_GR", "pl_PL", "ro_RO", "hu_HU", "en_GB", "de_DE",
    "es_ES", "it_IT", "fr_FR", "ja_JP", "ko_KR", "es_MX", "es_AR",
    "pt_BR", "en_US", "en_AU", "ru_RU", "tr_TR", "ms_MY", "en_PH",
    "en_SG", "th_TH", "vi_VN", "id_ID", "zh_MY", "zh_CN", "zh_TW"
}
STATIC_JSON_FILES = {
    "items": ("item.json", "item.json"),
    "champions": ("champion.json", "champion.json"),
    "summoner_spells": ("summoner_spells.json", "summoner.json"),
    "runes": ("runesReforged.json", "runesReforged.json")
}
spectator_data_lock = threading.RLock()
live_state_lock = threading.RLock()
spectator_data = None
spectator_data_revision = 0
current_game_time = None
last_live_game_time = None
spectator_mode_enabled = True


def default_spectator_data():
    return {
        "teams": {
            team: {
                **{field: 0 for field in OBJECTIVE_FIELDS},
                "Dragons": [],
                "BaronBuffUntil": None,
                "ElderBuffUntil": None,
            }
            for team in TEAMS
        },
        "objectives": {
            "dragon": {"lastKillAt": None},
            "baron": {"lastKillAt": None},
        },
    }


spectator_data = default_spectator_data()


def validate_spectator_data(data):
    if not isinstance(data, dict):
        raise ValueError("観戦データの形式が不正です。")

    teams = data.get("teams")
    objectives = data.get("objectives")
    if not isinstance(teams, dict) or not isinstance(objectives, dict):
        raise ValueError("観戦データにチーム情報またはオブジェクト情報がありません。")

    normalized = default_spectator_data()
    for team in TEAMS:
        team_data = teams.get(team)
        if not isinstance(team_data, dict):
            raise ValueError(f"{team} の観戦データがありません。")

        for field in OBJECTIVE_FIELDS:
            count = team_data.get(field)
            if type(count) is not int or count < 0:
                raise ValueError(f"{team} の{OBJECTIVE_FIELDS[field]}取得数が不正です。")
            normalized["teams"][team][field] = count

        dragons = team_data.get("Dragons")
        if not isinstance(dragons, list) or any(dragon not in DRAGON_TYPES for dragon in dragons):
            raise ValueError(f"{team} のドラゴン種類履歴が不正です。")
        dragon_count = team_data["DragonKill"]
        if len(dragons) > dragon_count:
            raise ValueError(f"{team} のドラゴン種類履歴は取得数を超えられません。")
        normalized["teams"][team]["Dragons"] = list(dragons)

        for field in ("BaronBuffUntil", "ElderBuffUntil"):
            expires_at = team_data.get(field)
            if expires_at is not None and (type(expires_at) is not int or expires_at < 0):
                raise ValueError(f"{team} の{field}が不正です。")
            normalized["teams"][team][field] = expires_at

    for objective, count_field in (("dragon", "DragonKill"), ("baron", "BaronKill")):
        objective_data = objectives.get(objective)
        if not isinstance(objective_data, dict):
            raise ValueError(f"{objective} のタイマー情報がありません。")
        last_kill_at = objective_data.get("lastKillAt")
        if last_kill_at is not None and (type(last_kill_at) is not int or last_kill_at < 0):
            raise ValueError(f"{objective} の最終撃破時刻が不正です。")
        total_kills = sum(normalized["teams"][team][count_field] for team in TEAMS)
        if total_kills == 0 and last_kill_at is not None:
            raise ValueError(f"{objective} の取得数が0の場合、最終撃破時刻は空欄にしてください。")
        normalized["objectives"][objective]["lastKillAt"] = last_kill_at

    return normalized


def load_spectator_data():
    global spectator_data
    data_path = SPECTATOR_DATA_PATH
    migrate_legacy_data = False
    if not os.path.exists(data_path) and os.path.exists(LEGACY_SPECTATOR_DATA_PATH):
        data_path = LEGACY_SPECTATOR_DATA_PATH
        migrate_legacy_data = True

    if os.path.exists(data_path):
        try:
            with open(data_path, "r", encoding="utf-8") as data_file:
                loaded_data = json.load(data_file)
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"観戦データを読み込めません: {error}") from error
        spectator_data = validate_spectator_data(loaded_data)
        if migrate_legacy_data:
            save_spectator_data(spectator_data)
    else:
        spectator_data = default_spectator_data()


def save_spectator_data(data):
    global spectator_data, spectator_data_revision
    validated_data = validate_spectator_data(data)
    temporary_path = SPECTATOR_DATA_PATH + ".tmp"
    with spectator_data_lock:
        try:
            os.makedirs(os.path.dirname(SPECTATOR_DATA_PATH), exist_ok=True)
            with open(temporary_path, "w", encoding="utf-8") as data_file:
                json.dump(validated_data, data_file, ensure_ascii=False, indent=2)
            os.replace(temporary_path, SPECTATOR_DATA_PATH)
        except OSError:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
            raise
        spectator_data = validated_data
        spectator_data_revision += 1


def get_spectator_data():
    with spectator_data_lock:
        return deepcopy(spectator_data)


def get_spectator_data_revision():
    with spectator_data_lock:
        return spectator_data_revision


def get_current_game_time():
    with live_state_lock:
        return current_game_time


def reset_spectator_data():
    save_spectator_data(default_spectator_data())


def observe_live_api(response):
    global current_game_time, last_live_game_time
    data = response.get("data") if response.get("ok") else None
    game_data = data.get("gameData") if isinstance(data, dict) else None
    all_players = data.get("allPlayers") if isinstance(data, dict) else None
    raw_game_time = game_data.get("gameTime", game_data.get("gametime")) \
        if isinstance(game_data, dict) else None
    try:
        game_time = int(float(raw_game_time))
    except (OverflowError, TypeError, ValueError):
        game_time = None

    is_available = isinstance(all_players, list) and game_time is not None
    with live_state_lock:
        if is_available:
            if last_live_game_time is not None and game_time < last_live_game_time:
                reset_spectator_data()
            current_game_time = game_time
            last_live_game_time = game_time
            return True

        current_game_time = None
    return False


def parse_game_time(value, label):
    value = value.strip()
    if not value:
        return None

    parts = value.split(":")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        raise ValueError(f"{label}は MM:SS 形式で入力してください。")
    minutes, seconds = (int(part) for part in parts)
    if seconds >= 60:
        raise ValueError(f"{label}の秒数は0～59で入力してください。")
    return minutes * 60 + seconds


class SpectatorDataEditor:
    def __init__(self, root):
        self.root = root
        self.root.title("LoL Overlay - 観戦データ")
        self.root.resizable(False, False)
        self.entries = {}
        self.buff_entries = {}
        self.dragon_history_frames = {}
        self.dragon_images = {}
        self.dragon_type_buttons = {}
        self.dragon_history_images = {}
        self.objective_images = {}
        self.dragon_history_fallback_image = None
        self.game_time_display = tk.StringVar(value="試合時間: --:--")
        self.spectator_mode_var = tk.BooleanVar(value=get_spectator_mode_enabled())
        self.is_spectator_game = False
        self.last_seen_revision = get_spectator_data_revision()

        content = ttk.Frame(root, padding=12)
        content.grid(sticky="nsew")
        ttk.Label(content, textvariable=self.game_time_display).grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 4)
        )
        ttk.Checkbutton(
            content,
            text="観戦モード",
            variable=self.spectator_mode_var,
            command=self.toggle_spectator_mode,
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 4))

        self.editor_panel = ttk.Frame(content)
        self.editor_panel.grid(row=2, column=0, columnspan=3, sticky="w")
        if not self.spectator_mode_var.get():
            self.editor_panel.grid_remove()

        objective_icons = {
            "HordeKill": "icon_voidclub.png",
            "HeraldKill": "icon_herald.png",
            "BaronKill": "icon_baron.png",
            "DragonKill": "icon_dragon.png",
        }
        for team_index, team in enumerate(TEAMS):
            team_frame = ttk.LabelFrame(self.editor_panel, text=team, padding=10)
            team_frame.grid(row=team_index, column=0, padx=5, pady=4, sticky="ew")
            counters = ttk.Frame(team_frame)
            counters.grid(row=0, column=0, sticky="w")
            count_fields = ("HordeKill", "HeraldKill", "BaronKill")
            for column, field in enumerate(count_fields):
                icon_path = os.path.join(RESOURCE_DIR, "assets", objective_icons[field])
                image = tk.PhotoImage(file=icon_path)
                scale = max(1, (image.width() + 31) // 32, (image.height() + 31) // 32)
                if scale > 1:
                    image = image.subsample(scale, scale)
                self.objective_images[(team, field)] = image
                counter = ttk.Frame(counters, padding=(0, 0, 12, 0))
                counter.grid(row=0, column=column, sticky="w")
                ttk.Label(counter, image=image).grid(row=0, column=0, padx=(0, 2))
                variable = tk.StringVar()
                ttk.Button(
                    counter,
                    text="-",
                    width=2,
                    command=lambda team=team, field=field: self.adjust_count(team, field, -1),
                ).grid(row=0, column=1, padx=1)
                entry = ttk.Entry(counter, textvariable=variable, width=4, justify="center")
                entry.grid(row=0, column=2)
                entry.bind(
                    "<FocusOut>",
                    lambda _event, team=team, field=field: self.commit_count_entry(team, field),
                )
                entry.bind(
                    "<Return>",
                    lambda _event, team=team, field=field: self.commit_count_entry(team, field),
                )
                ttk.Button(
                    counter,
                    text="+",
                    width=2,
                    command=lambda team=team, field=field: self.adjust_count(team, field, 1),
                ).grid(row=0, column=3, padx=1)
                self.entries[(team, field)] = variable

            dragon_frame = ttk.Frame(team_frame)
            dragon_frame.grid(row=1, column=0, sticky="w", pady=(6, 0))
            dragon_icon_path = os.path.join(RESOURCE_DIR, "assets", objective_icons["DragonKill"])
            dragon_icon = tk.PhotoImage(file=dragon_icon_path)
            scale = max(1, (dragon_icon.width() + 31) // 32, (dragon_icon.height() + 31) // 32)
            if scale > 1:
                dragon_icon = dragon_icon.subsample(scale, scale)
            self.objective_images[(team, "DragonKill")] = dragon_icon
            ttk.Label(dragon_frame, image=dragon_icon).grid(row=0, column=0, padx=(0, 2))
            dragon_count = tk.StringVar()
            ttk.Button(
                dragon_frame,
                text="-",
                width=2,
                command=lambda team=team: self.adjust_count(team, "DragonKill", -1),
            ).grid(row=0, column=1, padx=1)
            dragon_entry = ttk.Entry(dragon_frame, textvariable=dragon_count, width=4, justify="center")
            dragon_entry.grid(row=0, column=2)
            dragon_entry.bind(
                "<FocusOut>",
                lambda _event, team=team: self.commit_count_entry(team, "DragonKill"),
            )
            dragon_entry.bind(
                "<Return>",
                lambda _event, team=team: self.commit_count_entry(team, "DragonKill"),
            )
            self.entries[(team, "DragonKill")] = dragon_count

            dragon_buttons = ttk.Frame(dragon_frame)
            dragon_buttons.grid(row=0, column=3, sticky="w", padx=(8, 0))
            for index, (dragon, _label, icon_file) in enumerate(DRAGON_BUTTONS):
                icon_path = os.path.join(RESOURCE_DIR, "assets", icon_file)
                image = tk.PhotoImage(file=icon_path)
                scale = max(1, (image.width() + 31) // 32, (image.height() + 31) // 32)
                if scale > 1:
                    image = image.subsample(scale, scale)
                button_image = image.zoom(2, 2).subsample(3, 3)
                self.dragon_history_images.setdefault(dragon, button_image)
                self.dragon_images[(team, dragon)] = button_image
                button = ttk.Button(
                    dragon_buttons,
                    image=button_image,
                    command=lambda team=team, dragon=dragon: self.add_dragon(team, dragon),
                )
                button.grid(row=0, column=index, padx=2)
                self.dragon_type_buttons[(team, dragon)] = button

            details = ttk.Frame(team_frame)
            details.grid(row=2, column=0, sticky="w", pady=(6, 0))
            history_panel = ttk.Frame(details)
            history_panel.grid(row=0, column=0, sticky="nw")
            ttk.Label(history_panel, text="取得履歴").grid(row=0, column=0, sticky="w")
            history = ttk.Frame(history_panel)
            history.grid(row=0, column=1, sticky="w", padx=(4, 0))
            for column in range(4):
                history.grid_columnconfigure(column, minsize=24)
            self.dragon_history_frames[team] = history

            buff_panel = ttk.Frame(details, padding=(12, 0, 0, 0))
            buff_panel.grid(row=0, column=1, sticky="nw")
            for offset, (field, label) in enumerate((
                ("BaronBuffUntil", "バロンバフ終了時刻"),
                ("ElderBuffUntil", "エルダーバフ終了時刻"),
            )):
                ttk.Label(buff_panel, text=label).grid(
                    row=offset, column=0, sticky="w", pady=(0, 2)
                )
                variable = tk.StringVar()
                entry = ttk.Entry(buff_panel, textvariable=variable, width=8)
                entry.grid(row=offset, column=1, sticky="w", padx=(4, 0), pady=(0, 2))
                entry.bind("<FocusOut>", self.commit_time_fields)
                entry.bind("<Return>", self.commit_time_fields)
                self.buff_entries[(team, field)] = variable


        buttons = ttk.Frame(self.editor_panel)
        buttons.grid(row=3, column=0, sticky="e")
        ttk.Button(buttons, text="全データをクリア", command=self.clear_data).grid(row=0, column=0, padx=4)

        self.load_form(get_spectator_data())
        self.set_editor_inputs_enabled(False)
        self.root.after(100, self.refresh_live_api)

    def set_editor_inputs_enabled(self, enabled):
        def set_widget_state(widget):
            if isinstance(widget, (ttk.Button, ttk.Entry)):
                widget.state(["!disabled"] if enabled else ["disabled"])
            for child in widget.winfo_children():
                set_widget_state(child)

        set_widget_state(self.editor_panel)

    def toggle_spectator_mode(self):
        global spectator_mode_enabled
        enabled = self.spectator_mode_var.get()
        try:
            save_spectator_mode_enabled(enabled)
        except (OSError, configparser.Error, ValueError) as error:
            self.spectator_mode_var.set(spectator_mode_enabled)
            self.show_save_error(error)
            return

        with live_state_lock:
            spectator_mode_enabled = enabled
        if enabled:
            self.editor_panel.grid()
        else:
            self.editor_panel.grid_remove()

    @staticmethod
    def format_game_time(seconds):
        if seconds is None:
            return ""
        return f"{seconds // 60:02d}:{seconds % 60:02d}"

    def load_form(self, data):
        for team in TEAMS:
            team_data = data["teams"][team]
            for field in OBJECTIVE_FIELDS:
                self.entries[(team, field)].set(str(team_data[field]))
            history = self.dragon_history_frames[team]
            for child in history.winfo_children():
                child.destroy()
            if team_data["Dragons"]:
                for index, dragon in enumerate(team_data["Dragons"][:4]):
                    image = self.dragon_history_images.get(dragon)
                    if image is None:
                        if self.dragon_history_fallback_image is None:
                            icon_path = os.path.join(RESOURCE_DIR, "assets", "icon_dragon.png")
                            fallback = tk.PhotoImage(file=icon_path)
                            scale = max(
                                1,
                                (fallback.width() + 39) // 40,
                                (fallback.height() + 39) // 40,
                            )
                            if scale > 1:
                                fallback = fallback.subsample(scale, scale)
                            self.dragon_history_fallback_image = fallback
                        image = self.dragon_history_fallback_image
                    ttk.Label(history, image=image).grid(
                        row=index // 4, column=index % 4, padx=(0, 2), sticky="w"
                    )
            else:
                ttk.Label(history, text="なし").grid(row=0, column=0, sticky="w")
            for field in ("BaronBuffUntil", "ElderBuffUntil"):
                self.buff_entries[(team, field)].set(self.format_game_time(team_data[field]))
        total_dragons = sum(data["teams"][team]["DragonKill"] for team in TEAMS)
        for team in TEAMS:
            for dragon, _, _ in DRAGON_BUTTONS:
                enabled = self.is_spectator_game and (
                    total_dragons >= 4 if dragon == "Elder" else total_dragons < 4
                )
                self.dragon_type_buttons[(team, dragon)].state(
                    ["!disabled"] if enabled else ["disabled"]
                )

    def show_save_error(self, error):
        messagebox.showerror("保存エラー", str(error), parent=self.root)

    def update_objective_time(self, data, team, field, old_count, new_count):
        objective = {"DragonKill": "dragon", "BaronKill": "baron"}.get(field)
        if objective is None:
            return
        game_time = get_current_game_time()
        if new_count > old_count and game_time is not None:
            data["objectives"][objective]["lastKillAt"] = game_time
            team_data = data["teams"][team]
            if objective == "baron":
                team_data["BaronBuffUntil"] = game_time + 180
            elif sum(data["teams"][side]["DragonKill"] for side in TEAMS) >= 5:
                team_data["ElderBuffUntil"] = game_time + 150
        elif sum(data["teams"][team][field] for team in TEAMS) == 0:
            data["objectives"][objective]["lastKillAt"] = None

    def commit_count(self, team, field, new_count):
        data = get_spectator_data()
        team_data = data["teams"][team]
        old_count = team_data[field]
        if new_count < 0:
            new_count = 0
        team_data[field] = new_count
        if field == "DragonKill" and len(team_data["Dragons"]) > new_count:
            team_data["Dragons"] = team_data["Dragons"][:new_count]
        self.update_objective_time(data, team, field, old_count, new_count)
        try:
            save_spectator_data(data)
        except (OSError, ValueError) as error:
            self.show_save_error(error)
            return False
        self.last_seen_revision = get_spectator_data_revision()
        self.load_form(data)
        return True

    def adjust_count(self, team, field, amount):
        count = get_spectator_data()["teams"][team][field]
        self.commit_count(team, field, max(0, count + amount))

    def commit_count_entry(self, team, field):
        raw_count = self.entries[(team, field)].get().strip()
        if not raw_count.isdigit():
            self.load_form(get_spectator_data())
            messagebox.showerror(
                "入力エラー",
                f"{team} の{OBJECTIVE_FIELDS[field]}取得数は0以上の整数で入力してください。",
                parent=self.root,
            )
            return
        self.commit_count(team, field, int(raw_count))

    def add_dragon(self, team, dragon):
        data = get_spectator_data()
        team_data = data["teams"][team]
        total_dragons = sum(data["teams"][side]["DragonKill"] for side in TEAMS)
        if dragon == "Elder" and total_dragons < 4:
            return
        if dragon != "Elder" and total_dragons >= 4:
            return
        if len(team_data["Dragons"]) >= team_data["DragonKill"]:
            old_count = team_data["DragonKill"]
            team_data["DragonKill"] += 1
            self.update_objective_time(
                data, team, "DragonKill", old_count, team_data["DragonKill"]
            )
        if total_dragons < 4 and len(team_data["Dragons"]) < 4:
            team_data["Dragons"].append(dragon)
        try:
            save_spectator_data(data)
        except (OSError, ValueError) as error:
            self.show_save_error(error)
            return
        self.last_seen_revision = get_spectator_data_revision()
        self.load_form(data)

    def commit_time_fields(self, _event=None):
        data = get_spectator_data()
        try:
            for (team, field), variable in self.buff_entries.items():
                data["teams"][team][field] = parse_game_time(
                    variable.get(), f"{team} の{field}"
                )
            save_spectator_data(data)
        except (OSError, ValueError) as error:
            self.load_form(get_spectator_data())
            self.show_save_error(error)
            return
        self.last_seen_revision = get_spectator_data_revision()

    def refresh_live_api(self):
        try:
            response = fetch_lcu("allgamedata")
            available = observe_live_api(response)
            game_data = response.get("data")
            is_spectator_game = available and isinstance(game_data, dict) \
                and is_spectator_game_data(game_data)
            if is_spectator_game != self.is_spectator_game:
                self.is_spectator_game = is_spectator_game
                self.set_editor_inputs_enabled(is_spectator_game)
                self.load_form(get_spectator_data())
            if available:
                game_time = get_current_game_time()
                self.game_time_display.set(
                    f"試合時間: {self.format_game_time(game_time)}"
                )
            else:
                self.game_time_display.set("試合時間: --:--")

            revision = get_spectator_data_revision()
            if revision != self.last_seen_revision:
                self.load_form(get_spectator_data())
                self.last_seen_revision = revision
        except (OSError, ValueError) as error:
            self.show_save_error(error)
        finally:
            self.root.after(1000, self.refresh_live_api)

    def clear_data(self):
        if not messagebox.askyesno("確認", "観戦データをすべてクリアしますか？", parent=self.root):
            return
        data = default_spectator_data()
        try:
            save_spectator_data(data)
        except OSError as error:
            self.show_save_error(error)
            return
        self.load_form(data)
        self.last_seen_revision = get_spectator_data_revision()


def initialize_json_directory():
    os.makedirs(JSON_DIR, exist_ok=True)


def initialize_settings():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w", encoding="utf-8") as settings_file:
            settings_file.write(
                f"[settings]\nlanguage = {DEFAULT_LANGUAGE}\nspectator_mode = true\n"
            )

    get_language_code()
    global spectator_mode_enabled
    spectator_mode_enabled = load_spectator_mode_setting()


def load_spectator_mode_setting():
    parser = configparser.ConfigParser()
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8-sig") as settings_file:
            parser.read_file(settings_file)
    except (OSError, configparser.Error) as error:
        raise ValueError(f"settings.ini を読み込めません: {error}") from error
    return parser.getboolean("settings", "spectator_mode", fallback=True)


def get_spectator_mode_enabled():
    with live_state_lock:
        return spectator_mode_enabled


def save_spectator_mode_enabled(enabled):
    parser = configparser.ConfigParser()
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8-sig") as settings_file:
            parser.read_file(settings_file)
        if not parser.has_section("settings"):
            parser.add_section("settings")
        parser.set("settings", "spectator_mode", "true" if enabled else "false")

        temporary_path = CONFIG_PATH + ".tmp"
        try:
            with open(temporary_path, "w", encoding="utf-8") as settings_file:
                parser.write(settings_file)
            os.replace(temporary_path, CONFIG_PATH)
        except OSError:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)
            raise
    except (OSError, configparser.Error) as error:
        raise ValueError(f"観戦モード設定を保存できません: {error}") from error

    global spectator_mode_enabled
    with live_state_lock:
        spectator_mode_enabled = enabled


def get_language_code():
    parser = configparser.ConfigParser()
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8-sig") as settings_file:
            parser.read_file(settings_file)
    except (OSError, configparser.Error) as error:
        raise ValueError(f"settings.ini を読み込めません: {error}") from error

    language = parser.get("settings", "language", fallback="").strip()
    if language not in SUPPORTED_LANGUAGES:
        supported = ", ".join(sorted(SUPPORTED_LANGUAGES))
        raise ValueError(
            f"settings.ini の language が不正です: {language or '(未設定)'}。"
            f"利用可能な言語コード: {supported}"
        )
    return language


def fetch_lcu(path):
    try:
        r = session.get(f"{BASE}/{path}", verify=False, timeout=0.3)
        return {"ok": True, "data": r.json()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_identity_variants(player):
    identities = (player.get("riotIdGameName"), player.get("summonerName"), player.get("riotId"))
    variants = set()
    for identity in identities:
        if isinstance(identity, str) and identity.strip():
            normalized = identity.strip().lower()
            variants.add(normalized)
            variants.add(normalized.split("#", 1)[0])
    return variants


def is_spectator_game_data(data):
    game_data = data.get("gameData")
    game_mode = str(game_data.get("gameMode", "") if isinstance(game_data, dict) else "").upper()
    if game_mode == "SPECTATOR":
        return True

    active_player = data.get("activePlayer")
    if not isinstance(active_player, dict):
        return True

    active_player_team = str(active_player.get("team", "")).upper()
    if active_player_team in TEAMS:
        return False

    active_identities = get_identity_variants(active_player)
    if not active_identities:
        return True
    all_players = data.get("allPlayers")
    if not isinstance(all_players, list):
        return True
    return not any(
        active_identities.intersection(get_identity_variants(player))
        for player in all_players
        if isinstance(player, dict)
    )


def serve_static_json(json_key):
    filename, data_dragon_filename = STATIC_JSON_FILES[json_key]
    try:
        language = get_language_code()
    except ValueError as error:
        print(error)
        return jsonify({"ok": False, "error": str(error)}), 500

    language_json_dir = os.path.join(JSON_DIR, language)
    path = os.path.join(language_json_dir, filename)
    url = (
        f"https://ddragon.leagueoflegends.com/cdn/{DATA_DRAGON_VERSION}"
        f"/data/{language}/{data_dragon_filename}"
    )
    os.makedirs(language_json_dir, exist_ok=True)

    if not os.path.exists(path):
        try:
            r = requests.get(url, timeout=2)
            r.raise_for_status()

            with open(path, "w", encoding="utf-8") as f:
                json.dump(r.json(), f, ensure_ascii=False, indent=2)

        except Exception as e:
            print(f"{filename} ({language}) のダウンロードに失敗:", e)
            return jsonify({
                "ok": False,
                "error": f"{filename} ({language}) の取得に失敗しました: {e}"
            }), 500

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return jsonify({"ok": True, "data": data})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/html/<path:filename>")
def overlay_html(filename):
    return send_from_directory(os.path.join(APP_DIR, "html"), filename)


@app.route("/css/<path:filename>")
def overlay_css(filename):
    return send_from_directory(os.path.join(APP_DIR, "css"), filename)


@app.route("/js/<path:filename>")
def overlay_js(filename):
    response = send_from_directory(os.path.join(APP_DIR, "js"), filename)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/assets/<path:filename>")
def overlay_asset(filename):
    return send_from_directory(os.path.join(APP_DIR, "assets"), filename)


@app.route("/allgamedata")
def allgamedata():
    response = fetch_lcu("allgamedata")
    data = response.get("data")
    if observe_live_api(response) and isinstance(data, dict):
        data["isSpectatorMode"] = is_spectator_game_data(data)
        if get_spectator_mode_enabled():
            data["spectatorData"] = get_spectator_data()
    return jsonify(response)


@app.route("/playerlist")
def playerlist():
    return jsonify(fetch_lcu("playerlist"))


@app.route("/activeplayer")
def activeplayer():
    return jsonify(fetch_lcu("activeplayer"))


@app.route("/eventdata")
def eventdata():
    return jsonify(fetch_lcu("eventdata"))


@app.route("/gamestats")
def gamestats():
    return jsonify(fetch_lcu("gamestats"))


@app.route("/items")
def items():
    return serve_static_json("items")


@app.route("/champions")
def champions():
    return serve_static_json("champions")


@app.route("/summoner_spells")
def summoner_spells():
    return serve_static_json("summoner_spells")


@app.route("/runes")
def runes():
    return serve_static_json("runes")


def main():
    initialize_json_directory()
    initialize_settings()
    load_spectator_data()

    root = tk.Tk()
    SpectatorDataEditor(root)
    server = make_server("127.0.0.1", 8888, app, threaded=True)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    try:
        root.mainloop()
    finally:
        server.shutdown()
        server_thread.join(timeout=2)
        server.server_close()


if __name__ == "__main__":
    main()