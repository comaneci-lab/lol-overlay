from copy import deepcopy
from flask import Flask, jsonify, send_from_directory
import configparser
import hashlib
import json
import os
import posixpath
import re
import requests
import shutil
import sys
import tarfile
import tempfile
import threading
import tkinter as tk
from tkinter import messagebox, ttk
from urllib.parse import quote
import webbrowser
import urllib3
import zlib
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
DEFAULT_DATA_DRAGON_VERSION = "16.22.1"
DATA_DRAGON_VERSIONS_URL = "https://ddragon.leagueoflegends.com/api/versions.json"
DATA_DRAGON_ARCHIVE_URL = (
    "https://ddragon.leagueoflegends.com/cdn/dragontail-{version}.tgz"
)
DATA_DRAGON_ASSET_CONFIG_PATH = os.path.join(
    APP_DIR, "config", "data_dragon_assets.json"
)
DATA_DRAGON_VERSION_PATH = os.path.join(APP_DIR, ".ddragon-version")
OVERLAY_UPDATE_BASE_URL = "https://comaneci-lab.github.io/lol-overlay"
OVERLAY_UPDATE_MANIFEST_URL = f"{OVERLAY_UPDATE_BASE_URL}/update-manifest.json"
APP_UPDATE_MANIFEST_URL = f"{OVERLAY_UPDATE_BASE_URL}/app-update.json"
OVERLAY_UPDATE_CUSTOM_CSS_ROOT = "css/custom"
DEVELOPMENT_MARKER_FILENAME = ".dev-environment"
GITHUB_RELEASES_URL = "https://github.com/comaneci-lab/lol-overlay/releases"
OVERLAY_UPDATE_ROOTS = {"html": ".html", "css": ".css", "js": ".js"}
OVERLAY_UPDATE_MAX_FILES = 500
OVERLAY_UPDATE_MAX_FILE_SIZE = 5 * 1024 * 1024
OVERLAY_UPDATE_MAX_TOTAL_SIZE = 50 * 1024 * 1024
OVERLAY_UPDATE_MAX_MANIFEST_SIZE = 1024 * 1024
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
APP_VERSION_INFO_PATH = os.path.join(RESOURCE_DIR, "build", "app_version.json")
spectator_data_lock = threading.RLock()
live_state_lock = threading.RLock()
data_dragon_cache_lock = threading.RLock()
spectator_data = None
spectator_data_revision = 0
current_game_time = None
last_live_game_time = None
spectator_mode_enabled = True


def load_application_version():
    if not getattr(sys, "frozen", False):
        return "開発版"

    try:
        with open(APP_VERSION_INFO_PATH, encoding="utf-8") as version_file:
            version_info = json.load(version_file)
    except (OSError, ValueError):
        return "不明"

    version = version_info.get("version") if isinstance(version_info, dict) else None
    return version if isinstance(version, str) and version else "不明"


def load_application_commit_sha():
    if not getattr(sys, "frozen", False):
        return None

    try:
        with open(APP_VERSION_INFO_PATH, encoding="utf-8") as version_file:
            version_info = json.load(version_file)
    except (OSError, ValueError):
        return None

    commit_sha = (
        version_info.get("commit_sha") if isinstance(version_info, dict) else None
    )
    return commit_sha if isinstance(commit_sha, str) and re.fullmatch(
        r"[0-9a-f]{40}", commit_sha
    ) else None


APP_VERSION = load_application_version()
APP_COMMIT_SHA = load_application_commit_sha()


def is_development_environment():
    return os.path.isfile(os.path.join(APP_DIR, DEVELOPMENT_MARKER_FILENAME))


class OverlayUpdateError(ValueError):
    pass


class DataDragonUpdateError(ValueError):
    pass


def validate_data_dragon_version(version):
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise DataDragonUpdateError("Data Dragonのバージョン形式が不正です。")
    return version


def get_installed_data_dragon_version():
    try:
        with open(DATA_DRAGON_VERSION_PATH, encoding="utf-8") as version_file:
            version = version_file.read().strip()
    except FileNotFoundError:
        return DEFAULT_DATA_DRAGON_VERSION
    except OSError as error:
        raise DataDragonUpdateError(
            f"Data Dragonのバージョン情報を読み込めません: {error}"
        ) from error
    return validate_data_dragon_version(version)


def save_data_dragon_version(version):
    validate_data_dragon_version(version)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=APP_DIR,
            prefix=".ddragon-version-",
            suffix=".tmp",
            delete=False,
        ) as version_file:
            temporary_path = version_file.name
            version_file.write(version)
        os.replace(temporary_path, DATA_DRAGON_VERSION_PATH)
    except OSError as error:
        raise DataDragonUpdateError(
            f"Data Dragonのバージョン情報を保存できません: {error}"
        ) from error
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.remove(temporary_path)


def fetch_latest_data_dragon_version():
    with requests.get(DATA_DRAGON_VERSIONS_URL, timeout=(5, 30)) as response:
        response.raise_for_status()
        try:
            versions = response.json()
        except ValueError as error:
            raise DataDragonUpdateError(
                "Data Dragonのバージョン一覧をJSONとして読み込めません。"
            ) from error

    if not isinstance(versions, list) or not versions:
        raise DataDragonUpdateError("Data Dragonのバージョン一覧が空か不正です。")
    return validate_data_dragon_version(versions[0])


def check_data_dragon_update():
    installed_version = get_installed_data_dragon_version()
    latest_version = fetch_latest_data_dragon_version()
    installed_version_parts = tuple(
        int(part) for part in installed_version.split(".")
    )
    latest_version_parts = tuple(int(part) for part in latest_version.split("."))
    return {
        "installed_version": installed_version,
        "latest_version": latest_version,
        "update_available": installed_version_parts < latest_version_parts,
    }


def validate_data_dragon_relative_path(path, description):
    if (
        not isinstance(path, str)
        or not path
        or "\\" in path
        or path.startswith("/")
        or any(
            part in ("", ".", "..")
            or ":" in part
            or part.endswith((".", " "))
            for part in path.split("/")
        )
    ):
        raise DataDragonUpdateError(f"{description}のパスが不正です: {path}")
    return path


def load_data_dragon_asset_config(config_path=None):
    if config_path is None:
        config_path = DATA_DRAGON_ASSET_CONFIG_PATH
    try:
        with open(config_path, encoding="utf-8") as config_file:
            config = json.load(config_file)
    except (OSError, ValueError) as error:
        raise DataDragonUpdateError(
            f"Data Dragonのassets配置定義を読み込めません: {error}"
        ) from error

    if not isinstance(config, dict) or config.get("schema") != 1:
        raise DataDragonUpdateError("Data Dragonのassets配置定義が不正です。")
    if (
        config.get("copy_mode") != "merge_overwrite"
        or config.get("delete_files_not_in_archive") is not False
    ):
        raise DataDragonUpdateError("Data Dragonのassets更新方式が不正です。")

    archive_roots = config.get("archive_roots")
    mappings = config.get("directories")
    if not isinstance(archive_roots, dict) or not isinstance(mappings, list) or not mappings:
        raise DataDragonUpdateError("Data Dragonのassets配置一覧が不正です。")

    validated_roots = {}
    for root_name, root_path in archive_roots.items():
        if not isinstance(root_name, str) or not isinstance(root_path, str):
            raise DataDragonUpdateError("Data Dragonのアーカイブルートが不正です。")
        validated_roots[root_name] = root_path

    validated_mappings = []
    seen_destinations = set()
    for mapping in mappings:
        if not isinstance(mapping, dict):
            raise DataDragonUpdateError("Data Dragonのassets配置項目が不正です。")
        source_root = mapping.get("source_root")
        if not isinstance(source_root, str) or source_root not in validated_roots:
            raise DataDragonUpdateError("Data Dragonのコピー元ルートが未定義です。")
        source = validate_data_dragon_relative_path(
            mapping.get("source"), "コピー元"
        )
        destination = validate_data_dragon_relative_path(
            mapping.get("destination"), "配置先"
        )
        if destination in seen_destinations:
            raise DataDragonUpdateError(f"assetsの配置先が重複しています: {destination}")
        seen_destinations.add(destination)
        validated_mappings.append({
            "source_root": source_root,
            "source": source,
            "destination": destination,
        })

    return {
        "archive_roots": validated_roots,
        "directories": validated_mappings,
    }


def get_data_dragon_archive_prefixes(version, config):
    prefixes = []
    for mapping in config["directories"]:
        root_template = config["archive_roots"][mapping["source_root"]]
        root_path = root_template.replace("{version}", version)
        root_path = validate_data_dragon_relative_path(root_path, "アーカイブルート")
        prefixes.append((
            posixpath.join(root_path, mapping["source"]),
            mapping["destination"],
        ))
    return prefixes


def download_data_dragon_archive(version, archive_path, progress_callback=None):
    url = DATA_DRAGON_ARCHIVE_URL.format(version=version)
    downloaded_bytes = 0
    last_reported_bytes = 0
    with requests.get(url, stream=True, timeout=(5, 60)) as response:
        response.raise_for_status()
        with open(archive_path, "wb") as archive_file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                archive_file.write(chunk)
                downloaded_bytes += len(chunk)
                if (
                    progress_callback
                    and downloaded_bytes - last_reported_bytes >= 8 * 1024 * 1024
                ):
                    progress_callback(
                        f"Data Dragonをダウンロード中 ({downloaded_bytes // (1024 * 1024)} MB)"
                    )
                    last_reported_bytes = downloaded_bytes
    if downloaded_bytes == 0:
        raise DataDragonUpdateError("Data Dragonのアーカイブが空です。")


def stage_data_dragon_assets(archive_path, version, config, staging_directory, progress_callback=None):
    staged_assets = os.path.join(staging_directory, "assets")
    prefixes = get_data_dragon_archive_prefixes(version, config)
    copied_counts = {destination: 0 for _, destination in prefixes}
    seen_files = set()

    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            for member in archive:
                member_name = member.name
                if "\\" in member_name or member_name.startswith("/"):
                    continue
                if ".." in member_name.split("/"):
                    continue
                normalized_name = posixpath.normpath(member_name)
                if normalized_name in ("", ".", "..") or normalized_name.startswith("../"):
                    continue

                matching_prefixes = [
                    (prefix, destination)
                    for prefix, destination in prefixes
                    if normalized_name.startswith(prefix + "/")
                ]
                if not matching_prefixes:
                    continue
                if len(matching_prefixes) != 1:
                    raise DataDragonUpdateError(
                        f"アーカイブ内の配置先が重複しています: {member_name}"
                    )
                if member.isdir():
                    continue
                if not member.isfile():
                    raise DataDragonUpdateError(
                        f"通常ファイルではないassetsが含まれています: {member_name}"
                    )

                prefix, destination = matching_prefixes[0]
                relative_path = normalized_name[len(prefix) + 1:]
                validate_data_dragon_relative_path(relative_path, "アーカイブ内")
                staged_relative_path = posixpath.join(destination, relative_path)
                if staged_relative_path in seen_files:
                    raise DataDragonUpdateError(
                        f"アーカイブ内のファイルが重複しています: {member_name}"
                    )
                seen_files.add(staged_relative_path)

                target_path = os.path.abspath(os.path.join(
                    staged_assets, *staged_relative_path.split("/")
                ))
                if os.path.commonpath((os.path.abspath(staged_assets), target_path)) != os.path.abspath(staged_assets):
                    raise DataDragonUpdateError(
                        f"アーカイブ内の配置先が不正です: {member_name}"
                    )
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                source_file = archive.extractfile(member)
                if source_file is None:
                    raise DataDragonUpdateError(
                        f"アーカイブ内のファイルを読み込めません: {member_name}"
                    )
                with source_file, open(target_path, "wb") as target_file:
                    shutil.copyfileobj(source_file, target_file)
                copied_counts[destination] += 1
                if progress_callback and sum(copied_counts.values()) % 500 == 0:
                    progress_callback(
                        f"Data Dragonを展開中 ({sum(copied_counts.values())} ファイル)"
                    )
    except (tarfile.TarError, OSError, EOFError, zlib.error) as error:
        raise DataDragonUpdateError(
            f"Data Dragonのアーカイブを展開できません: {error}"
        ) from error

    missing_directories = [
        destination for destination, count in copied_counts.items() if count == 0
    ]
    if missing_directories:
        raise DataDragonUpdateError(
            "アーカイブに必要なassetsがありません: "
            + ", ".join(sorted(missing_directories))
        )
    return staged_assets, sum(copied_counts.values())


def get_data_dragon_asset_target(relative_path):
    assets_root = os.path.abspath(os.path.join(APP_DIR, "assets"))
    if os.path.islink(assets_root):
        raise DataDragonUpdateError("assetsフォルダーがシンボリックリンクです。")
    target_path = os.path.abspath(
        os.path.join(assets_root, *relative_path.split("/"))
    )
    if os.path.commonpath((assets_root, target_path)) != assets_root:
        raise DataDragonUpdateError(f"assetsの配置先が不正です: {relative_path}")

    current_path = assets_root
    for part in relative_path.split("/"):
        current_path = os.path.join(current_path, part)
        if os.path.islink(current_path):
            raise DataDragonUpdateError(
                f"assetsの配置先にシンボリックリンクがあります: {relative_path}"
            )
    return target_path


def install_staged_data_dragon_assets(staged_assets, backup_root):
    changed_files = []
    installed_files = 0
    try:
        for current_root, _directories, filenames in os.walk(staged_assets):
            for filename in filenames:
                staged_path = os.path.join(current_root, filename)
                relative_path = os.path.relpath(
                    staged_path, staged_assets
                ).replace(os.sep, "/")
                target_path = get_data_dragon_asset_target(relative_path)
                if os.path.lexists(target_path) and not os.path.isfile(target_path):
                    raise DataDragonUpdateError(
                        f"assetsの配置先が通常ファイルではありません: {relative_path}"
                    )

                backup_path = os.path.join(
                    backup_root, *relative_path.split("/")
                )
                existed = os.path.isfile(target_path)
                if existed:
                    os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                    shutil.copy2(target_path, backup_path)
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                os.replace(staged_path, target_path)
                changed_files.append((target_path, backup_path if existed else None))
                installed_files += 1
    except (DataDragonUpdateError, OSError) as error:
        rollback_errors = rollback_data_dragon_asset_files(changed_files)
        if rollback_errors:
            raise DataDragonUpdateError(
                f"{error}\nassetsのロールバックにも失敗しました: "
                + "; ".join(rollback_errors)
            ) from error
        if isinstance(error, DataDragonUpdateError):
            raise
        raise DataDragonUpdateError(f"assetsを配置できません: {error}") from error
    return changed_files, installed_files


def rollback_data_dragon_asset_files(changed_files):
    rollback_errors = []
    for target_path, backup_path in reversed(changed_files):
        try:
            if backup_path:
                os.replace(backup_path, target_path)
            elif os.path.exists(target_path):
                os.remove(target_path)
        except OSError as error:
            rollback_errors.append(f"{target_path}: {error}")
    return rollback_errors


def move_data_dragon_json_cache_to_backup(backup_directory):
    moved_directories = []
    if os.path.islink(JSON_DIR):
        raise DataDragonUpdateError("JSONフォルダーがシンボリックリンクです。")
    os.makedirs(backup_directory, exist_ok=True)
    try:
        for language in sorted(SUPPORTED_LANGUAGES):
            cache_path = os.path.join(JSON_DIR, language)
            if not os.path.lexists(cache_path):
                continue
            if os.path.islink(cache_path) or not os.path.isdir(cache_path):
                raise DataDragonUpdateError(
                    f"JSONキャッシュの保存先が不正です: {cache_path}"
                )
            backup_path = os.path.join(backup_directory, language)
            os.replace(cache_path, backup_path)
            moved_directories.append((cache_path, backup_path))
    except (DataDragonUpdateError, OSError) as error:
        rollback_errors = restore_data_dragon_json_cache(moved_directories)
        if rollback_errors:
            raise DataDragonUpdateError(
                f"{error}\nJSONキャッシュのロールバックにも失敗しました: "
                + "; ".join(rollback_errors)
            ) from error
        raise
    return moved_directories


def restore_data_dragon_json_cache(moved_directories):
    restore_errors = []
    for cache_path, backup_path in reversed(moved_directories):
        try:
            if os.path.lexists(cache_path):
                raise OSError(f"復元先が既に存在します: {cache_path}")
            os.replace(backup_path, cache_path)
        except OSError as error:
            restore_errors.append(str(error))
    return restore_errors


def update_data_dragon_assets(progress_callback=None):
    version = fetch_latest_data_dragon_version()
    config = load_data_dragon_asset_config()
    os.makedirs(APP_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".ddragon-update-",
        dir=APP_DIR,
    ) as staging_directory:
        archive_path = os.path.join(staging_directory, "dragontail.tgz")
        download_data_dragon_archive(version, archive_path, progress_callback)
        staged_assets, staged_file_count = stage_data_dragon_assets(
            archive_path,
            version,
            config,
            staging_directory,
            progress_callback,
        )

        backup_root = os.path.join(staging_directory, "asset-backup")
        cache_backup = os.path.join(staging_directory, "json-cache-backup")
        with data_dragon_cache_lock:
            changed_files = []
            moved_caches = []
            try:
                changed_files, installed_file_count = install_staged_data_dragon_assets(
                    staged_assets,
                    backup_root,
                )
                moved_caches = move_data_dragon_json_cache_to_backup(cache_backup)
                save_data_dragon_version(version)
            except (DataDragonUpdateError, OSError) as error:
                cache_rollback_errors = restore_data_dragon_json_cache(moved_caches)
                asset_rollback_errors = rollback_data_dragon_asset_files(changed_files)
                rollback_errors = cache_rollback_errors + asset_rollback_errors
                if rollback_errors:
                    raise DataDragonUpdateError(
                        f"{error}\nロールバックにも失敗しました: "
                        + "; ".join(rollback_errors)
                    ) from error
                raise

    if progress_callback:
        progress_callback("Data DragonのassetsとJSONキャッシュを更新しました")
    return {
        "version": version,
        "installed_files": installed_file_count,
        "staged_files": staged_file_count,
        "cleared_languages": len(moved_caches),
    }


def validate_overlay_update_manifest(manifest):
    if (
        not isinstance(manifest, dict)
        or type(manifest.get("schema")) is not int
        or manifest["schema"] != 1
    ):
        raise OverlayUpdateError("更新マニフェストの形式またはバージョンが不正です。")

    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"[0-9a-f]{40}", version):
        raise OverlayUpdateError("更新マニフェストのバージョンが不正です。")

    files = manifest.get("files")
    if not isinstance(files, list) or not files or len(files) > OVERLAY_UPDATE_MAX_FILES:
        raise OverlayUpdateError("更新マニフェストのファイル一覧が不正です。")

    validated_files = []
    seen_paths = set()
    total_size = 0
    for file_info in files:
        if not isinstance(file_info, dict):
            raise OverlayUpdateError("更新マニフェストに不正なファイル情報があります。")

        relative_path = file_info.get("path")
        if not isinstance(relative_path, str) or "\\" in relative_path:
            raise OverlayUpdateError("更新対象のパスが不正です。")
        path_parts = relative_path.split("/")
        if "/".join(path_parts[:2]) == OVERLAY_UPDATE_CUSTOM_CSS_ROOT:
            raise OverlayUpdateError("利用者用CSSは更新対象にできません。")
        if (
            len(path_parts) < 2
            or path_parts[0] not in OVERLAY_UPDATE_ROOTS
            or any(
                part in ("", ".", "..")
                or not re.fullmatch(r"[A-Za-z0-9_.-]+", part)
                for part in path_parts
            )
            or os.path.splitext(path_parts[-1])[1].lower()
            != OVERLAY_UPDATE_ROOTS[path_parts[0]]
        ):
            raise OverlayUpdateError(f"更新対象外のファイルです: {relative_path}")
        if relative_path in seen_paths:
            raise OverlayUpdateError(f"更新対象が重複しています: {relative_path}")
        seen_paths.add(relative_path)

        size = file_info.get("size")
        if type(size) is not int or size < 0 or size > OVERLAY_UPDATE_MAX_FILE_SIZE:
            raise OverlayUpdateError(f"ファイルサイズが不正です: {relative_path}")
        total_size += size
        if total_size > OVERLAY_UPDATE_MAX_TOTAL_SIZE:
            raise OverlayUpdateError("更新ファイルの合計サイズが上限を超えています。")

        digest = file_info.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise OverlayUpdateError(f"ファイルのハッシュ値が不正です: {relative_path}")

        validated_files.append({
            "path": relative_path,
            "size": size,
            "sha256": digest.lower(),
        })

    return version, validated_files


def hash_overlay_update_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source_file:
        for chunk in iter(lambda: source_file.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_overlay_update_target_path(install_root, relative_path):
    root_path = os.path.abspath(install_root)
    target_path = os.path.abspath(
        os.path.join(root_path, *relative_path.split("/"))
    )
    if os.path.commonpath((root_path, target_path)) != root_path:
        raise OverlayUpdateError(f"更新対象のパスが不正です: {relative_path}")

    current_path = root_path
    for part in relative_path.split("/"):
        current_path = os.path.join(current_path, part)
        if os.path.islink(current_path):
            raise OverlayUpdateError(f"更新先にシンボリックリンクがあります: {relative_path}")
    return target_path


def fetch_overlay_update_manifest():
    with requests.get(
        OVERLAY_UPDATE_MANIFEST_URL,
        headers={"Cache-Control": "no-cache"},
        timeout=(5, 20),
    ) as response:
        if response.status_code == 404:
            raise OverlayUpdateError(
                "GitHub Pagesの更新マニフェストが見つかりません。"
                "Pagesの有効化とデプロイ状況を確認してください。"
            )
        response.raise_for_status()
        if len(response.content) > OVERLAY_UPDATE_MAX_MANIFEST_SIZE:
            raise OverlayUpdateError("更新マニフェストが大きすぎます。")
        try:
            manifest = response.json()
        except ValueError as error:
            raise OverlayUpdateError("更新マニフェストをJSONとして読み込めません。") from error

    return validate_overlay_update_manifest(manifest)


def get_overlay_update_candidates(files, install_root=None):
    if install_root is None:
        install_root = APP_DIR

    files_to_update = []
    for file_info in files:
        target_path = get_overlay_update_target_path(install_root, file_info["path"])
        if not os.path.isfile(target_path):
            files_to_update.append(file_info)
            continue
        if hash_overlay_update_file(target_path) != file_info["sha256"]:
            files_to_update.append(file_info)
    return files_to_update


def ensure_custom_overlay_stylesheet(install_root):
    relative_path = f"{OVERLAY_UPDATE_CUSTOM_CSS_ROOT}/LoLOverlay.custom.css"
    target_path = get_overlay_update_target_path(install_root, relative_path)
    if os.path.exists(target_path):
        if not os.path.isfile(target_path):
            raise OverlayUpdateError(f"利用者用CSSの保存先がファイルではありません: {target_path}")
        return

    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    try:
        with open(target_path, "x", encoding="utf-8") as custom_css:
            custom_css.write(
                "/* Add personal overlay style overrides here. "
                "This file is not updated automatically. */\n"
            )
    except FileExistsError:
        if not os.path.isfile(target_path):
            raise OverlayUpdateError(f"利用者用CSSの保存先が不正です: {target_path}")
    except OSError as error:
        raise OverlayUpdateError(
            f"利用者用CSSを作成できませんでした: {target_path} ({error})"
        ) from error


def check_overlay_updates(install_root=None):
    if install_root is None:
        install_root = APP_DIR
    ensure_custom_overlay_stylesheet(install_root)
    version, files = fetch_overlay_update_manifest()
    files_to_update = get_overlay_update_candidates(files, install_root)
    return {"version": version, "available_files": len(files_to_update)}


def prepare_overlay_update(install_root=None):
    if install_root is None:
        install_root = APP_DIR

    ensure_custom_overlay_stylesheet(install_root)
    version, files = fetch_overlay_update_manifest()
    files_to_update = get_overlay_update_candidates(files, install_root)

    css_files_to_backup = [
        file_info
        for file_info in files_to_update
        if file_info["path"].startswith("css/")
        and os.path.isfile(
            get_overlay_update_target_path(install_root, file_info["path"])
        )
    ]

    backup_directory = None
    if css_files_to_backup:
        backup_directory = tempfile.mkdtemp(
            prefix=".overlay-css-backup-",
            dir=install_root,
        )
        try:
            for file_info in css_files_to_backup:
                relative_path = file_info["path"]
                target_path = get_overlay_update_target_path(install_root, relative_path)
                backup_path = os.path.join(
                    backup_directory,
                    *relative_path.split("/"),
                )
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                shutil.copy2(target_path, backup_path)
        except OSError as error:
            raise OverlayUpdateError(
                f"CSSのバックアップに失敗しました。バックアップ先: "
                f"{backup_directory} ({error})"
            ) from error

    return {
        "version": version,
        "files_to_update": files_to_update,
        "css_backup_directory": backup_directory,
        "css_backup_files": [file_info["path"] for file_info in css_files_to_backup],
    }


def verify_overlay_css_backup(prepared_update, install_root):
    backup_directory = prepared_update["css_backup_directory"]
    if backup_directory is None:
        return

    for relative_path in prepared_update["css_backup_files"]:
        target_path = get_overlay_update_target_path(install_root, relative_path)
        backup_path = os.path.join(backup_directory, *relative_path.split("/"))
        if (
            not os.path.isfile(target_path)
            or not os.path.isfile(backup_path)
            or hash_overlay_update_file(target_path) != hash_overlay_update_file(backup_path)
        ):
            raise OverlayUpdateError(
                f"バックアップ後にCSSが変更されたため更新を中止しました: {relative_path}"
            )


def parse_release_version(tag):
    if not isinstance(tag, str):
        return None
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", tag)
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def validate_application_update_manifest(manifest):
    if (
        not isinstance(manifest, dict)
        or type(manifest.get("schema")) is not int
        or manifest["schema"] != 1
    ):
        raise OverlayUpdateError("アプリ更新情報の形式が不正です。")

    version = manifest.get("version")
    if parse_release_version(version) is None:
        raise OverlayUpdateError("アプリ更新情報のバージョン形式が不正です。")

    commit_sha = manifest.get("commit_sha")
    if not isinstance(commit_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        raise OverlayUpdateError("アプリ更新情報のコミットSHAが不正です。")

    binary_sha256 = manifest.get("sha256")
    if not isinstance(binary_sha256, str) or not re.fullmatch(
        r"[0-9a-f]{64}", binary_sha256
    ):
        raise OverlayUpdateError("アプリ更新情報のSHA-256が不正です。")

    release_url = manifest.get("release_url")
    expected_release_url = (
        f"{GITHUB_RELEASES_URL}/tag/{quote(version, safe='')}"
    )
    if release_url != expected_release_url:
        raise OverlayUpdateError("アプリ更新情報のRelease URLが不正です。")

    return manifest


def hash_application_binary(executable_path):
    digest = hashlib.sha256()
    with open(executable_path, "rb") as executable_file:
        for chunk in iter(lambda: executable_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_application_release_update(
    current_version=APP_VERSION,
    current_commit_sha=APP_COMMIT_SHA,
    executable_path=None,
):
    current_version_parts = parse_release_version(current_version)
    if current_version_parts is None:
        return {"supported": False, "tag_name": None, "update_available": False}

    with requests.get(
        APP_UPDATE_MANIFEST_URL,
        headers={
            "Accept": "application/json",
            "Cache-Control": "no-cache",
            "User-Agent": "lol-overlay",
        },
        timeout=(5, 15),
    ) as response:
        response.raise_for_status()
        try:
            manifest = response.json()
        except ValueError as error:
            raise OverlayUpdateError(
                "アプリ更新情報をJSONとして読み込めません。"
            ) from error

    manifest = validate_application_update_manifest(manifest)
    latest_tag = manifest["version"]
    latest_version_parts = parse_release_version(latest_tag)
    if latest_version_parts is None:
        raise OverlayUpdateError("アプリ更新情報のバージョン形式が不正です。")
    current_binary_path = executable_path or sys.executable
    current_binary_sha256 = hash_application_binary(current_binary_path)
    binary_changed = current_binary_sha256 != manifest["sha256"]

    update_available = (
        latest_version_parts >= current_version_parts and binary_changed
    )

    return {
        "supported": True,
        "tag_name": latest_tag,
        "commit_sha": manifest["commit_sha"],
        "sha256": manifest["sha256"],
        "binary_sha256": current_binary_sha256,
        "source_commit_matches": (
            current_commit_sha == manifest["commit_sha"]
            if current_commit_sha is not None
            else None
        ),
        "release_url": manifest["release_url"],
        "update_available": update_available,
    }


def install_overlay_update_files(staging_directory, files):
    for file_info in files:
        target_path = get_overlay_update_target_path(APP_DIR, file_info["path"])
        if os.path.exists(target_path) and not os.path.isfile(target_path):
            raise OverlayUpdateError(f"更新先がファイルではありません: {file_info['path']}")

    backup_directory = os.path.join(staging_directory, "backup")
    changed_targets = []
    try:
        for file_info in files:
            relative_path = file_info["path"]
            path_parts = relative_path.split("/")
            staged_path = os.path.join(staging_directory, "download", *path_parts)
            target_path = get_overlay_update_target_path(APP_DIR, relative_path)
            os.makedirs(os.path.dirname(target_path), exist_ok=True)

            backup_path = None
            if os.path.isfile(target_path):
                backup_path = os.path.join(backup_directory, *path_parts)
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                shutil.copy2(target_path, backup_path)

            changed_targets.append((target_path, backup_path))
            os.replace(staged_path, target_path)
    except OSError as error:
        rollback_errors = []
        for target_path, backup_path in reversed(changed_targets):
            try:
                if backup_path:
                    os.replace(backup_path, target_path)
                elif os.path.exists(target_path):
                    os.remove(target_path)
            except OSError as rollback_error:
                rollback_errors.append(str(rollback_error))

        details = f"更新ファイルを配置できませんでした: {error}"
        if rollback_errors:
            details += f" 元のファイルへの復元にも失敗しました: {'; '.join(rollback_errors)}"
        raise OverlayUpdateError(details) from error


def update_overlay_files(progress_callback=None, prepared_update=None):
    if prepared_update is None:
        prepared_update = prepare_overlay_update()

    version = prepared_update["version"]
    files_to_update = prepared_update["files_to_update"]
    backup_directory = prepared_update["css_backup_directory"]

    if not files_to_update:
        return {"version": version, "updated_files": 0}

    with tempfile.TemporaryDirectory(prefix=".overlay-update-", dir=APP_DIR) as staging_directory:
        for index, file_info in enumerate(files_to_update, start=1):
            relative_path = file_info["path"]
            if progress_callback:
                progress_callback(f"更新ファイルを取得中 ({index}/{len(files_to_update)}): {relative_path}")

            download_url = (
                f"{OVERLAY_UPDATE_BASE_URL}/"
                f"{quote(relative_path, safe='/')}?v={version}"
            )
            with requests.get(download_url, stream=True, timeout=(5, 30)) as response:
                if response.status_code == 404:
                    raise OverlayUpdateError(f"更新ファイルが見つかりません: {relative_path}")
                response.raise_for_status()
                staged_path = os.path.join(staging_directory, "download", *relative_path.split("/"))
                os.makedirs(os.path.dirname(staged_path), exist_ok=True)
                file_digest = hashlib.sha256()
                downloaded_size = 0
                with open(staged_path, "wb") as staged_file:
                    for chunk in response.iter_content(chunk_size=64 * 1024):
                        if not chunk:
                            continue
                        downloaded_size += len(chunk)
                        if downloaded_size > file_info["size"]:
                            raise OverlayUpdateError(f"ファイルサイズが一致しません: {relative_path}")
                        file_digest.update(chunk)
                        staged_file.write(chunk)

            if downloaded_size != file_info["size"]:
                raise OverlayUpdateError(f"ファイルサイズが一致しません: {relative_path}")
            if file_digest.hexdigest() != file_info["sha256"]:
                raise OverlayUpdateError(f"ファイルの検証に失敗しました: {relative_path}")

        verify_overlay_css_backup(prepared_update, APP_DIR)
        install_overlay_update_files(staging_directory, files_to_update)

    result = {"version": version, "updated_files": len(files_to_update)}
    if backup_directory:
        result["css_backup_directory"] = backup_directory
    return result


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
        self.root.title("LoL Overlay")
        self.root.geometry("1120x760")
        self.root.minsize(980, 680)
        self.root.resizable(True, True)
        self.root.configure(background="#111827")
        style = ttk.Style(root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure(".", font=("Segoe UI", 10))
        style.configure("TFrame", background="#111827")
        style.configure("App.TFrame", background="#111827")
        style.configure("TLabel", background="#111827", foreground="#e5e7eb")
        style.configure(
            "Title.TLabel",
            font=("Segoe UI", 20, "bold"),
            foreground="#f8fafc",
        )
        style.configure(
            "Subtitle.TLabel",
            foreground="#94a3b8",
            font=("Segoe UI", 9),
        )
        style.configure(
            "Status.TLabel",
            background="#1e293b",
            foreground="#93c5fd",
            padding=(10, 5),
            font=("Segoe UI", 9, "bold"),
        )
        style.configure(
            "Status.Good.TLabel",
            background="#14332c",
            foreground="#86efac",
        )
        style.configure(
            "Status.Warning.TLabel",
            background="#3a2a14",
            foreground="#fcd34d",
        )
        style.configure(
            "TLabelframe",
            background="#1e293b",
            bordercolor="#334155",
            relief="solid",
            padding=10,
        )
        style.configure(
            "TLabelframe.Label",
            background="#1e293b",
            foreground="#e2e8f0",
            font=("Segoe UI", 10, "bold"),
        )
        style.configure(
            "Order.TLabelframe",
            background="#172b45",
            bordercolor="#2563eb",
        )
        style.configure(
            "Order.TLabelframe.Label",
            background="#172b45",
            foreground="#93c5fd",
        )
        style.configure("Order.TFrame", background="#172b45")
        style.configure(
            "Order.TLabel",
            background="#172b45",
            foreground="#dbeafe",
        )
        style.configure(
            "Chaos.TLabelframe",
            background="#3b2028",
            bordercolor="#dc2626",
        )
        style.configure(
            "Chaos.TLabelframe.Label",
            background="#3b2028",
            foreground="#fca5a5",
        )
        style.configure("Chaos.TFrame", background="#3b2028")
        style.configure(
            "Chaos.TLabel",
            background="#3b2028",
            foreground="#fee2e2",
        )
        style.configure(
            "TNotebook",
            background="#111827",
            borderwidth=0,
        )
        style.configure(
            "TNotebook.Tab",
            background="#1e293b",
            foreground="#cbd5e1",
            padding=(16, 9),
            font=("Segoe UI", 10, "bold"),
        )
        style.map(
            "TNotebook.Tab",
            background=[("selected", "#334155"), ("active", "#27364a")],
            foreground=[("selected", "#f8fafc")],
        )
        style.configure(
            "TButton",
            background="#334155",
            foreground="#f8fafc",
            bordercolor="#475569",
            padding=(10, 6),
        )
        style.map(
            "TButton",
            background=[("disabled", "#1e293b"), ("active", "#475569")],
            foreground=[("disabled", "#64748b")],
        )
        style.configure(
            "Accent.TButton",
            background="#2563eb",
            foreground="#ffffff",
            bordercolor="#3b82f6",
            font=("Segoe UI", 10, "bold"),
        )
        style.map(
            "Accent.TButton",
            background=[("disabled", "#1e293b"), ("active", "#1d4ed8")],
        )
        style.configure(
            "Danger.TButton",
            background="#7f1d1d",
            foreground="#fee2e2",
            bordercolor="#991b1b",
        )
        style.map("Danger.TButton", background=[("active", "#991b1b")])
        style.configure(
            "Small.TButton",
            padding=(3, 2),
            font=("Segoe UI", 9),
        )
        style.configure(
            "TEntry",
            fieldbackground="#0f172a",
            foreground="#f8fafc",
            insertcolor="#f8fafc",
        )
        style.configure(
            "TCheckbutton",
            background="#111827",
            foreground="#e5e7eb",
        )
        self.entries = {}
        self.buff_entries = {}
        self.dragon_history_frames = {}
        self.dragon_images = {}
        self.dragon_type_buttons = {}
        self.dragon_history_images = {}
        self.objective_images = {}
        self.dragon_history_fallback_image = None
        self.game_time_display = tk.StringVar(value="試合時間: --:--")
        self.game_state_display = tk.StringVar(value="接続確認中")
        self.spectator_mode_var = tk.BooleanVar(value=get_spectator_mode_enabled())
        self.is_spectator_game = False
        self.last_seen_revision = get_spectator_data_revision()

        content = ttk.Frame(root, padding=18, style="App.TFrame")
        content.grid(row=0, column=0, sticky="nsew")
        root.grid_rowconfigure(0, weight=1)
        root.grid_columnconfigure(0, weight=1)
        content.grid_rowconfigure(1, weight=1)
        content.grid_columnconfigure(0, weight=1)

        header = ttk.Frame(content, style="App.TFrame")
        header.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        header.grid_columnconfigure(0, weight=1)
        title_block = ttk.Frame(header, style="App.TFrame")
        title_block.grid(row=0, column=0, sticky="w")
        ttk.Label(
            title_block,
            text="LoL OVERLAY",
            style="Title.TLabel",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            title_block,
            text="OBS GAME COMPANION",
            style="Subtitle.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(1, 0))
        ttk.Label(
            header,
            text=f"APP  {APP_VERSION}",
            style="Status.TLabel",
        ).grid(row=0, column=1, rowspan=2, sticky="e", padx=(12, 0))
        self.game_state_label = ttk.Label(
            header,
            textvariable=self.game_state_display,
            style="Status.TLabel",
        )
        self.game_state_label.grid(row=2, column=0, sticky="w", pady=(10, 0))
        ttk.Label(
            header,
            text="ローカルAPI  127.0.0.1:8888",
            style="Subtitle.TLabel",
        ).grid(row=2, column=1, sticky="e", pady=(10, 0))

        self.tabs = ttk.Notebook(content)
        self.tabs.grid(row=1, column=0, sticky="nsew")
        config_tab = ttk.Frame(self.tabs, padding=14, style="App.TFrame")
        data_tab = ttk.Frame(self.tabs, padding=14, style="App.TFrame")
        update_tab = ttk.Frame(self.tabs, padding=14, style="App.TFrame")
        data_tab.grid_columnconfigure(0, weight=1)
        update_tab.grid_columnconfigure(0, weight=1)

        self.setup_config_tab()


        self.tabs.add(data_tab, text="観戦モード")
        self.tabs.add(update_tab, text="更新")



        game_summary = ttk.Frame(data_tab, style="App.TFrame")
        game_summary.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        ttk.Label(
            game_summary,
            textvariable=self.game_time_display,
            font=("Segoe UI", 12, "bold"),
        ).grid(row=0, column=0, sticky="w")
        ttk.Checkbutton(
            game_summary,
            text="観戦モード",
            variable=self.spectator_mode_var,
            command=self.toggle_spectator_mode,
        ).grid(row=0, column=1, sticky="e", padx=(12, 0))
        game_summary.grid_columnconfigure(0, weight=1)

        self.editor_panel = ttk.Frame(data_tab, style="App.TFrame")
        self.editor_panel.grid(row=1, column=0, sticky="nsew")
        self.editor_panel.grid_columnconfigure(0, weight=1)
        self.editor_panel.grid_columnconfigure(1, weight=1)
        data_tab.grid_rowconfigure(1, weight=1)
        if not self.spectator_mode_var.get():
            self.editor_panel.grid_remove()

        self.overlay_update_in_progress = False
        self.data_dragon_update_in_progress = False
        self.overlay_update_status = tk.StringVar(value="更新状況を確認中...")
        try:
            data_dragon_version_status = (
                f"Data Dragon: {get_installed_data_dragon_version()}"
            )
        except DataDragonUpdateError as error:
            data_dragon_version_status = f"Data Dragonのバージョン情報を読めません: {error}"
        self.data_dragon_update_status = tk.StringVar(
            value=data_dragon_version_status
        )
        self.data_language_status = tk.StringVar(
            value=f"JSON言語: {get_language_code()}"
        )
        self.application_version_status = tk.StringVar(
            value=f"実行ファイル: {APP_VERSION}"
        )
        self.application_release_status = tk.StringVar(
            value="アプリ更新情報を確認中..."
        )
        self.application_release_url = None

        overlay_update_card = ttk.LabelFrame(
            update_tab,
            text="オーバーレイ",
            padding=12,
        )
        overlay_update_card.grid(row=0, column=0, sticky="ew", pady=(0, 10))
        overlay_update_card.grid_columnconfigure(0, weight=1)
        ttk.Label(
            overlay_update_card,
            text="HTML・CSS・JavaScript",
            style="Subtitle.TLabel",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            overlay_update_card,
            textvariable=self.overlay_update_status,
            wraplength=650,
        ).grid(row=1, column=0, sticky="w", pady=(5, 0))
        self.overlay_update_button = ttk.Button(
            overlay_update_card,
            text="オーバーレイを最新化",
            command=self.start_overlay_update,
            style="Accent.TButton",
        )
        self.overlay_update_button.grid(row=0, column=1, rowspan=2, sticky="e", padx=(12, 0))
        self.overlay_update_button.state(["disabled"])

        application_update_card = ttk.LabelFrame(
            update_tab,
            text="実行ファイル",
            padding=12,
        )
        application_update_card.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        application_update_card.grid_columnconfigure(0, weight=1)
        ttk.Label(
            application_update_card,
            textvariable=self.application_version_status,
            style="Subtitle.TLabel",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            application_update_card,
            textvariable=self.application_release_status,
            wraplength=650,
        ).grid(row=1, column=0, sticky="w", pady=(5, 0))
        self.release_page_button = ttk.Button(
            application_update_card,
            text="GitHub Releases",
            command=self.open_github_releases,
        )
        self.release_page_button.grid(row=0, column=1, rowspan=2, sticky="e", padx=(12, 0))
        self.release_page_button.state(["disabled"])

        data_dragon_update_card = ttk.LabelFrame(
            update_tab,
            text="Data Dragon",
            padding=12,
        )
        data_dragon_update_card.grid(row=2, column=0, sticky="ew")
        data_dragon_update_card.grid_columnconfigure(0, weight=1)
        ttk.Label(
            data_dragon_update_card,
            text="チャンピオン画像・ゲームデータ(JSON)",
            style="Subtitle.TLabel",
        ).grid(row=0, column=0, sticky="w")
        ttk.Label(
            data_dragon_update_card,
            textvariable=self.data_dragon_update_status,
            wraplength=650,
        ).grid(row=1, column=0, sticky="w", pady=(5, 0))
        ttk.Label(
            data_dragon_update_card,
            textvariable=self.data_language_status,
            style="Subtitle.TLabel",
        ).grid(row=2, column=0, sticky="w", pady=(5, 0))
        self.data_dragon_update_button = ttk.Button(
            data_dragon_update_card,
            text="assets・JSONを最新化",
            command=self.start_data_dragon_update,
            style="Accent.TButton",
        )
        self.data_dragon_update_button.grid(
            row=0,
            column=1,
            rowspan=3,
            sticky="e",
            padx=(12, 0),
        )
        self.data_dragon_update_button.state(["disabled"])

        objective_icons = {
            "HordeKill": "icon_voidclub.png",
            "HeraldKill": "icon_herald.png",
            "BaronKill": "icon_baron.png",
            "DragonKill": "icon_dragon.png",
        }
        self.editor_panel.grid_rowconfigure(0, weight=1)
        for team_index, team in enumerate(TEAMS):
            team_style = "Order.TLabelframe" if team == "ORDER" else "Chaos.TLabelframe"
            team_frame = ttk.LabelFrame(
                self.editor_panel,
                text=team,
                padding=10,
                style=team_style,
            )
            team_frame.grid(
                row=0,
                column=team_index,
                padx=6,
                pady=4,
                sticky="nsew",
            )
            team_container_style = "Order.TFrame" if team == "ORDER" else "Chaos.TFrame"
            team_label_style = "Order.TLabel" if team == "ORDER" else "Chaos.TLabel"
            counters = ttk.Frame(team_frame, style=team_container_style)
            counters.grid(row=0, column=0, sticky="w")
            count_fields = ("HordeKill", "HeraldKill", "BaronKill")
            for column, field in enumerate(count_fields):
                icon_path = os.path.join(RESOURCE_DIR, "assets", objective_icons[field])
                image = tk.PhotoImage(file=icon_path)
                scale = max(1, (image.width() + 31) // 32, (image.height() + 31) // 32)
                if scale > 1:
                    image = image.subsample(scale, scale)
                self.objective_images[(team, field)] = image
                counter = ttk.Frame(
                    counters,
                    padding=(0, 0, 12, 0),
                    style=team_container_style,
                )
                counter.grid(row=0, column=column, sticky="w")
                ttk.Label(
                    counter,
                    image=image,
                    style=team_label_style,
                ).grid(row=0, column=0, padx=(0, 2))
                variable = tk.StringVar()
                ttk.Button(
                    counter,
                    text="-",
                    width=2,
                    command=lambda team=team, field=field: self.adjust_count(team, field, -1),
                    style="Small.TButton",
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
                    style="Small.TButton",
                ).grid(row=0, column=3, padx=1)
                self.entries[(team, field)] = variable

            dragon_frame = ttk.Frame(team_frame, style=team_container_style)
            dragon_frame.grid(row=1, column=0, sticky="w", pady=(6, 0))
            dragon_icon_path = os.path.join(RESOURCE_DIR, "assets", objective_icons["DragonKill"])
            dragon_icon = tk.PhotoImage(file=dragon_icon_path)
            scale = max(1, (dragon_icon.width() + 31) // 32, (dragon_icon.height() + 31) // 32)
            if scale > 1:
                dragon_icon = dragon_icon.subsample(scale, scale)
            self.objective_images[(team, "DragonKill")] = dragon_icon
            ttk.Label(
                dragon_frame,
                image=dragon_icon,
                style=team_label_style,
            ).grid(row=0, column=0, padx=(0, 2))
            dragon_count = tk.StringVar()
            ttk.Button(
                dragon_frame,
                text="-",
                width=2,
                command=lambda team=team: self.adjust_count(team, "DragonKill", -1),
                style="Small.TButton",
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

            dragon_buttons = ttk.Frame(dragon_frame, style=team_container_style)
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
                    style="Small.TButton",
                )
                button.grid(row=0, column=index, padx=2)
                self.dragon_type_buttons[(team, dragon)] = button

            details = ttk.Frame(team_frame, style=team_container_style)
            details.grid(row=2, column=0, sticky="w", pady=(6, 0))
            history_panel = ttk.Frame(details, style=team_container_style)
            history_panel.grid(row=0, column=0, sticky="nw")
            ttk.Label(
                history_panel,
                text="取得履歴",
                style=team_label_style,
            ).grid(row=0, column=0, sticky="w")
            history = ttk.Frame(history_panel, style=team_container_style)
            history.grid(row=0, column=1, sticky="w", padx=(4, 0))
            for column in range(4):
                history.grid_columnconfigure(column, minsize=24)
            self.dragon_history_frames[team] = history

            buff_panel = ttk.Frame(
                details,
                padding=(12, 0, 0, 0),
                style=team_container_style,
            )
            buff_panel.grid(row=0, column=1, sticky="nw")
            for offset, (field, label) in enumerate((
                ("BaronBuffUntil", "バロンバフ終了時刻"),
                ("ElderBuffUntil", "エルダーバフ終了時刻"),
            )):
                ttk.Label(
                    buff_panel,
                    text=label,
                    style=team_label_style,
                ).grid(
                    row=offset, column=0, sticky="w", pady=(0, 2)
                )
                variable = tk.StringVar()
                entry = ttk.Entry(buff_panel, textvariable=variable, width=8)
                entry.grid(row=offset, column=1, sticky="w", padx=(4, 0), pady=(0, 2))
                entry.bind("<FocusOut>", self.commit_time_fields)
                entry.bind("<Return>", self.commit_time_fields)
                self.buff_entries[(team, field)] = variable


        buttons = ttk.Frame(self.editor_panel)
        buttons.grid(row=1, column=0, columnspan=2, sticky="e", pady=(8, 0))
        ttk.Button(
            buttons,
            text="全データをクリア",
            command=self.clear_data,
            style="Danger.TButton",
        ).grid(row=0, column=0, padx=4)

        self.load_form(get_spectator_data())
        self.set_editor_inputs_enabled(False)
        self.root.after(100, self.refresh_live_api)
        self.root.after(0, self.start_update_checks)



    def on_html_selection_changed(self, _event=None):
        if self.html_tree.selection():
            self.html_copy_button.state(["!disabled"])
            self.html_status.set("")
        else:
            self.html_copy_button.state(["disabled"])

    def copy_html_url(self):
        selection = self.html_tree.selection()
        if not selection:
            return

        filename = self.html_tree.item(selection[0], "values")[0]
        url = f"http://127.0.0.1:8888/html/{quote(filename)}"
        try:
            self.root.clipboard_clear()
            self.root.clipboard_append(url)
            self.root.update_idletasks()
        except tk.TclError as error:
            messagebox.showerror(
                "コピーエラー",
                f"HTMLのURLをクリップボードにコピーできません: {error}",
                parent=self.root,
            )
            return

        self.html_status.set("URLをコピーしました。")

    def start_update_checks(self):
        self.start_data_dragon_update_check()
        if is_development_environment():
            self.overlay_update_status.set(
                "開発環境のためオーバーレイ更新チェックを無効にしています"
            )
            self.overlay_update_button.state(["disabled"])
            self.application_release_status.set(
                "開発環境のためRelease確認を無効にしています"
            )
            self.release_page_button.state(["disabled"])
            return

        threading.Thread(target=self.run_overlay_update_check, daemon=True).start()
        if parse_release_version(APP_VERSION) is None:
            self.application_release_status.set(
                "正式版のバージョン情報がないため比較できません"
            )
            return
        threading.Thread(target=self.run_application_release_check, daemon=True).start()

    def start_data_dragon_update_check(self):
        self.data_dragon_update_button.state(["disabled"])
        self.data_dragon_update_status.set("Data Dragonのバージョンを確認しています...")
        threading.Thread(
            target=self.run_data_dragon_update_check,
            daemon=True,
        ).start()

    def run_data_dragon_update_check(self):
        try:
            result = check_data_dragon_update()
        except (
            DataDragonUpdateError,
            requests.RequestException,
            OSError,
            ValueError,
        ) as error:
            self.root.after(0, self.finish_data_dragon_update_check, None, error)
            return
        self.root.after(0, self.finish_data_dragon_update_check, result, None)

    def finish_data_dragon_update_check(self, result, error):
        if error is not None:
            self.data_dragon_update_status.set(
                "Data Dragonの更新状況を確認できませんでした"
            )
            self.data_dragon_update_button.state(["!disabled"])
            return

        installed_version = result["installed_version"]
        latest_version = result["latest_version"]
        if result["update_available"]:
            self.data_dragon_update_status.set(
                f"更新があります: {installed_version} → {latest_version}"
            )
            self.data_dragon_update_button.state(["!disabled"])
        elif installed_version == latest_version:
            self.data_dragon_update_status.set(
                f"Assets・JSONは最新版です ({installed_version})"
            )
            self.data_dragon_update_button.state(["disabled"])
        else:
            self.data_dragon_update_status.set(
                f"Assets・JSONは最新公開版より新しいバージョンです ({installed_version})"
            )
            self.data_dragon_update_button.state(["disabled"])

    def start_data_dragon_update(self):
        if self.data_dragon_update_in_progress:
            return
        if not messagebox.askyesno(
            "Data Dragonの最新化",
            "Data Dragonから最新assetsを取得して配置し、JSONキャッシュを削除します。\n"
            "assets内の同名ファイルは上書きされ、未一致のファイルは残ります。"
            "全言語のJSONキャッシュは削除されますが、観戦データは削除されません。\n"
            "続行しますか？",
            parent=self.root,
        ):
            return

        self.data_dragon_update_in_progress = True
        self.data_dragon_update_button.state(["disabled"])
        self.data_dragon_update_status.set("Data Dragonの最新版を確認しています...")
        threading.Thread(
            target=self.run_data_dragon_update,
            daemon=True,
        ).start()

    def run_data_dragon_update(self):
        def report_progress(message):
            self.root.after(0, self.data_dragon_update_status.set, message)

        try:
            result = update_data_dragon_assets(report_progress)
        except (
            DataDragonUpdateError,
            requests.RequestException,
            OSError,
            ValueError,
        ) as error:
            self.root.after(0, self.finish_data_dragon_update, None, error)
            return
        self.root.after(0, self.finish_data_dragon_update, result, None)

    def finish_data_dragon_update(self, result, error):
        self.data_dragon_update_in_progress = False
        if error is not None:
            self.data_dragon_update_button.state(["!disabled"])
            self.data_dragon_update_status.set("Data Dragonの更新に失敗しました")
            messagebox.showerror(
                "Data Dragonの更新エラー",
                str(error),
                parent=self.root,
            )
            return

        version = result["version"]
        installed_files = result["installed_files"]
        self.data_dragon_update_button.state(["disabled"])
        self.data_dragon_update_status.set(
            f"Assets・JSONは最新版です ({version}, {installed_files} ファイル)"
        )
        messagebox.showinfo(
            "Data Dragonの最新化",
            f"Data Dragon {version} に更新しました。\n"
            "変更を反映するため、OBSのブラウザソースを再読み込みしてください。",
            parent=self.root,
        )

    def run_overlay_update_check(self):
        try:
            result = check_overlay_updates()
        except (OverlayUpdateError, requests.RequestException, OSError) as error:
            self.root.after(0, self.finish_overlay_update_check, None, error)
            return
        self.root.after(0, self.finish_overlay_update_check, result, None)

    def finish_overlay_update_check(self, result, error):
        if error is not None:
            self.overlay_update_status.set(
                "更新状況を確認できません。クリックして再試行できます"
            )
            self.overlay_update_button.state(["!disabled"])
            return

        version = result["version"][:7]
        available_files = result["available_files"]
        if available_files:
            self.overlay_update_status.set(
                f"更新があります: {available_files} ファイル ({version})"
            )
            self.overlay_update_button.state(["!disabled"])
            return

        self.overlay_update_status.set(f"オーバーレイは最新です ({version})")
        self.overlay_update_button.state(["disabled"])

    def run_application_release_check(self):
        try:
            result = check_application_release_update()
        except (OverlayUpdateError, requests.RequestException, OSError) as error:
            self.root.after(0, self.finish_application_release_check, None, error)
            return
        self.root.after(0, self.finish_application_release_check, result, None)

    def finish_application_release_check(self, result, error):
        if error is not None:
            self.application_release_url = None
            self.application_release_status.set(
                "アプリ更新情報を確認できませんでした"
            )
            self.release_page_button.state(["disabled"])
            return

        if not result["supported"]:
            self.application_release_url = None
            self.application_release_status.set(
                "正式版のバージョン情報がないため比較できません"
            )
            self.release_page_button.state(["disabled"])
        elif result["update_available"]:
            self.application_release_status.set(
                f"最新版 {result['tag_name']} が利用できます"
            )
            self.application_release_url = result["release_url"]
            self.release_page_button.state(["!disabled"])
        else:
            self.application_release_status.set(
                f"実行ファイルは最新です ({result['tag_name']})"
            )
            self.application_release_url = None
            self.release_page_button.state(["disabled"])

    def open_github_releases(self):
        release_url = self.application_release_url or GITHUB_RELEASES_URL
        if not webbrowser.open(release_url):
            messagebox.showerror(
                "ブラウザー起動エラー",
                "GitHub Releasesを開けませんでした。",
                parent=self.root,
            )

    def start_overlay_update(self):
        if is_development_environment():
            self.overlay_update_status.set(
                "開発環境のためオーバーレイ更新を無効にしています"
            )
            self.overlay_update_button.state(["disabled"])
            return
        if self.overlay_update_in_progress:
            return
        self.overlay_update_in_progress = True
        self.overlay_update_button.state(["disabled"])
        self.overlay_update_status.set("更新内容とCSS差分を確認しています...")
        threading.Thread(
            target=self.run_overlay_update_preparation,
            daemon=True,
        ).start()

    def run_overlay_update_preparation(self):
        try:
            prepared_update = prepare_overlay_update()
        except (OverlayUpdateError, requests.RequestException, OSError) as error:
            self.root.after(0, self.confirm_overlay_update, None, error)
            return
        self.root.after(0, self.confirm_overlay_update, prepared_update, None)

    def confirm_overlay_update(self, prepared_update, error):
        if error is not None:
            self.overlay_update_in_progress = False
            self.overlay_update_status.set("更新内容を確認できませんでした")
            self.overlay_update_button.state(["!disabled"])
            messagebox.showerror("更新エラー", str(error), parent=self.root)
            return

        files_to_update = prepared_update["files_to_update"]
        if not files_to_update:
            self.overlay_update_in_progress = False
            self.overlay_update_status.set(
                f"オーバーレイは最新です ({prepared_update['version'][:7]})"
            )
            self.overlay_update_button.state(["disabled"])
            return

        confirmation = (
            "GitHub PagesからHTML・CSS・JavaScriptを取得し、"
            "既存ファイルを上書きします。実行ファイル、assets、JSONは更新しません。"
        )
        backup_directory = prepared_update["css_backup_directory"]
        css_backup_files = prepared_update["css_backup_files"]
        if backup_directory:
            file_list = "\n".join(css_backup_files[:10])
            if len(css_backup_files) > 10:
                file_list += f"\nほか {len(css_backup_files) - 10} ファイル"
            confirmation += (
                "\n\nPages版と内容が異なるCSSを、上書き前にバックアップしました。"
                "古い公式版か利用者による編集かは判別できません。\n"
                f"対象:\n{file_list}\n"
                f"バックアップ先: {backup_directory}\n"
                "続行すると対象CSSを上書きします。キャンセルすると更新全体を中止します。"
            )

        if not messagebox.askyesno(
            "オーバーレイの最新化",
            confirmation,
            parent=self.root,
        ):
            self.overlay_update_in_progress = False
            self.overlay_update_button.state(["!disabled"])
            if backup_directory:
                self.overlay_update_status.set(
                    "更新をキャンセルしました（CSSバックアップを保存済み）"
                )
            else:
                self.overlay_update_status.set("更新をキャンセルしました")
            return

        self.overlay_update_status.set("更新ファイルを取得しています...")
        threading.Thread(
            target=self.run_overlay_update,
            args=(prepared_update,),
            daemon=True,
        ).start()

    def run_overlay_update(self, prepared_update):
        def report_progress(message):
            self.root.after(0, self.overlay_update_status.set, message)

        try:
            result = update_overlay_files(report_progress, prepared_update)
        except (OverlayUpdateError, requests.RequestException, OSError) as error:
            self.root.after(
                0,
                self.finish_overlay_update,
                None,
                error,
                prepared_update,
            )
            return
        self.root.after(
            0,
            self.finish_overlay_update,
            result,
            None,
            prepared_update,
        )

    def finish_overlay_update(self, result, error, prepared_update=None):
        self.overlay_update_in_progress = False
        if error is not None:
            self.overlay_update_status.set("更新に失敗しました。再試行できます")
            self.overlay_update_button.state(["!disabled"])
            error_message = str(error)
            if prepared_update and prepared_update["css_backup_directory"]:
                error_message += (
                    "\nCSSバックアップ: "
                    f"{prepared_update['css_backup_directory']}"
                )
            messagebox.showerror("更新エラー", error_message, parent=self.root)
            return

        version = result["version"][:7]
        updated_files = result["updated_files"]
        if updated_files == 0:
            self.overlay_update_status.set(f"オーバーレイは最新です ({version})")
            self.overlay_update_button.state(["disabled"])
            return

        self.overlay_update_status.set(f"更新完了: {updated_files} ファイル ({version})")
        self.overlay_update_button.state(["disabled"])
        completion_message = (
            "オーバーレイを更新しました。変更を反映するにはOBSのブラウザソースを再読み込みしてください。"
        )
        if result.get("css_backup_directory"):
            completion_message += (
                "\n\n上書き前のCSSバックアップ: "
                f"{result['css_backup_directory']}"
                "\n必要なスタイルは利用者用CSSへ移してください。"
            )
        messagebox.showinfo(
            "更新完了",
            completion_message,
            parent=self.root,
        )

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

    def get_html_files(self):
        """HTML ファイルの一覧を取得"""
        import os
        html_dir = os.path.join(APP_DIR, "html")
        files = []
        for filename in sorted(os.listdir(html_dir)):
            if os.path.isfile(os.path.join(html_dir, filename)) and filename.endswith('.html'):
                filepath = os.path.join("html", filename)
                url = f'<code>{filepath}</code> <a href="/html/{filename}" target="_blank">📂 表示</a>'
                files.append((filename, url))
        return files

    def create_html_view(self, tab):
        """HTML ファイル一覧ビューを作成する"""
        html_dir = os.path.join(APP_DIR, "html")
        files = self.get_html_files()  # HTML ファイルをリストに取得
        
        # HTML ファイルリスト用のフレーム
        list_frame = ttk.Frame(tab)
        list_frame.pack(fill="both", expand=True, padx=(0, 14), pady=8)

        row_count = 0

        for filename, url in files:
            lbl_file = ttk.Label(
                list_frame,
                text=filename
            )

            btn_open = ttk.Button(
                list_frame,
                text="Open",
                command=lambda f=filename: self.open_file(f)
            )

            btn_copy = ttk.Button(
                list_frame,
                text="Copy URL",
                command=lambda u=url: self.copy_to_clipboard(u)
            )

            lbl_file.grid(
                row=row_count, column=0,
                padx=(0, 10), pady=2, sticky="w"
            )

            btn_open.grid(
                row=row_count, column=1,
                padx=(0, 5), pady=2, sticky="w"
            )

            btn_copy.grid(
                row=row_count, column=2,
                padx=(0, 5), pady=2, sticky="w"
            )

            row_count += 1

    def setup_config_tab(self):
        config_tab = ttk.Frame(self.tabs, padding=14, style="App.TFrame")
        self.tabs.add(config_tab, text="設定")

        # HTML ファイル一覧ビューを作成して追加
        self.create_html_view(config_tab)


    def copy_to_clipboard(self, url):
        """指定された URL の一部をクリップボードにコピーする"""
        # URL から '/html/' 部分以降を抽出
        start_index = url.find('/html/')
        if start_index != -1:
            end = url.find('"', start_index)
            copied_text = url[start_index:end]
            self.root.clipboard_clear()
            self.root.clipboard_append(f"http://127.0.0.1:8888{copied_text}")

    def open_file(self, filename):
        """HTML ファイルを開く処理"""
        filepath = os.path.join("html", filename)
        url = f"http://127.0.0.1:8888/html/{filename}"
        webbrowser.open(url)

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
                self.game_state_display.set(
                    "観戦中" if is_spectator_game else "ゲーム中"
                )
                self.game_state_label.configure(style="Status.Good.TLabel")
                game_time = get_current_game_time()
                self.game_time_display.set(
                    f"試合時間: {self.format_game_time(game_time)}"
                )
            else:
                self.game_state_display.set("ゲーム未検出")
                self.game_state_label.configure(style="Status.TLabel")
                self.game_time_display.set("試合時間: --:--")

            revision = get_spectator_data_revision()
            if revision != self.last_seen_revision:
                self.load_form(get_spectator_data())
                self.last_seen_revision = revision
        except (OSError, ValueError) as error:
            self.game_state_display.set("接続を確認できません")
            self.game_state_label.configure(style="Status.Warning.TLabel")
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

    with data_dragon_cache_lock:
        try:
            data_dragon_version = get_installed_data_dragon_version()
        except DataDragonUpdateError as error:
            return jsonify({"ok": False, "error": str(error)}), 500

        language_json_dir = os.path.join(JSON_DIR, language)
        path = os.path.join(language_json_dir, filename)
        url = (
            f"https://ddragon.leagueoflegends.com/cdn/{data_dragon_version}"
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


def serve_champion_json(champion_name):
    if not re.fullmatch(r"[A-Za-z0-9]+", champion_name):
        return jsonify({"ok": False, "error": "チャンピオン名が不正です。"}), 400

    try:
        language = get_language_code()
    except ValueError as error:
        print(error)
        return jsonify({"ok": False, "error": str(error)}), 500

    with data_dragon_cache_lock:
        try:
            data_dragon_version = get_installed_data_dragon_version()
        except DataDragonUpdateError as error:
            return jsonify({"ok": False, "error": str(error)}), 500

        champion_json_dir = os.path.join(JSON_DIR, language, "champion")
        filename = f"{champion_name}.json"
        path = os.path.join(champion_json_dir, filename)
        url = (
            f"https://ddragon.leagueoflegends.com/cdn/{data_dragon_version}"
            f"/data/{language}/champion/{filename}"
        )
        os.makedirs(champion_json_dir, exist_ok=True)

        if not os.path.exists(path):
            try:
                response = requests.get(url, timeout=2)
                response.raise_for_status()

                with open(path, "w", encoding="utf-8") as data_file:
                    json.dump(response.json(), data_file, ensure_ascii=False, indent=2)
            except Exception as error:
                print(f"{filename} ({language}) のダウンロードに失敗:", error)
                return jsonify({
                    "ok": False,
                    "error": f"{filename} ({language}) の取得に失敗しました: {error}"
                }), 500

        try:
            with open(path, "r", encoding="utf-8") as data_file:
                data = json.load(data_file)
            return jsonify({"ok": True, "data": data})
        except Exception as error:
            return jsonify({"ok": False, "error": str(error)}), 500


def get_html_files(self):
    """HTML ファイルの一覧を取得"""
    import os
    html_dir = os.path.join(APP_DIR, "html")
    files = []
    for filename in sorted(os.listdir(html_dir)):
        if os.path.isfile(os.path.join(html_dir, filename)) and filename.endswith('.html'):
            filepath = os.path.join("html", filename)
            url = f'<code>{filepath}</code> <a href="/html/{filename}" target="_blank">📂 表示</a>'
            files.append((filename, url))
    return files

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


@app.route("/champion/<champion_name>")
def champion(champion_name):
    return serve_champion_json(champion_name)


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