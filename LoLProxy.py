from flask import Flask, jsonify
import configparser
import json
import os
import requests
import sys
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
session = requests.Session()

BASE            = "https://127.0.0.1:2999/liveclientdata"
APP_DIR         = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
JSON_DIR        = os.path.join(APP_DIR, "json")
CONFIG_PATH = os.path.join(APP_DIR, "settings.ini")
DEFAULT_LANGUAGE = "ja_JP"
DATA_DRAGON_VERSION = "16.4.1"
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


def initialize_json_directory():
    os.makedirs(JSON_DIR, exist_ok=True)


def initialize_settings():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w", encoding="utf-8") as settings_file:
            settings_file.write(f"[settings]\nlanguage = {DEFAULT_LANGUAGE}\n")

    get_language_code()


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


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.route("/allgamedata")
def allgamedata():
    return jsonify(fetch_lcu("allgamedata"))


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


if __name__ == "__main__":
    initialize_json_directory()
    initialize_settings()
    app.run(port=8888)