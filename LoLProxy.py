from flask import Flask, jsonify
import requests
import urllib3
import os
import json
import sys

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = Flask(__name__)
session = requests.Session()

BASE            = "https://127.0.0.1:2999/liveclientdata"
APP_DIR         = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
JSON_DIR        = os.path.join(APP_DIR, "json")

ITEM_PATH           = os.path.join(JSON_DIR, "item.json")
CHAMPION_PATH       = os.path.join(JSON_DIR, "champion.json")
SUMMONER_SPELL_PATH = os.path.join(JSON_DIR, "summoner_spells.json")
RUNE_PATH           = os.path.join(JSON_DIR, "runesReforged.json")
ITEM_URL            = "https://ddragon.leagueoflegends.com/cdn/16.4.1/data/ja_JP/item.json"
CHAMPION_URL        = "https://ddragon.leagueoflegends.com/cdn/16.4.1/data/ja_JP/champion.json"
SUMMONER_SPELL_URL  = "https://ddragon.leagueoflegends.com/cdn/16.4.1/data/ja_JP/summoner.json"
RUNE_URL            = "https://ddragon.leagueoflegends.com/cdn/16.4.1/data/ja_JP/runesReforged.json"


def initialize_json_directory():
    os.makedirs(JSON_DIR, exist_ok=True)


def fetch_lcu(path):
    try:
        r = session.get(f"{BASE}/{path}", verify=False, timeout=0.3)
        return {"ok": True, "data": r.json()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def serve_static_json(path, url, filename):
    initialize_json_directory()

    if not os.path.exists(path):
        try:
            # print(f"{filename} が無いためダウンロードします...")
            r = requests.get(url, timeout=2)
            r.raise_for_status()

            with open(path, "w", encoding="utf-8") as f:
                json.dump(r.json(), f, ensure_ascii=False, indent=2)

            # print(f"{filename} を保存しました。")
        except Exception as e:
            print(f"{filename} のダウンロードに失敗:", e)
            return jsonify({"ok": False, "error": f"{filename} の取得に失敗しました"}), 500

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
    return serve_static_json(ITEM_PATH, ITEM_URL, "item.json")


@app.route("/champions")
def champions():
    return serve_static_json(CHAMPION_PATH, CHAMPION_URL, "champion.json")


@app.route("/summoner_spells")
def summoner_spells():
    return serve_static_json(SUMMONER_SPELL_PATH, SUMMONER_SPELL_URL, "summoner_spells.json")


@app.route("/runes")
def runes():
    return serve_static_json(RUNE_PATH, RUNE_URL, "runesReforged.json")


if __name__ == "__main__":
    initialize_json_directory()
    app.run(port=8888)