import json


class OverlaySizeConfigError(ValueError):
    pass


def load_overlay_sizes(path):
    try:
        with open(path, encoding="utf-8") as source:
            config = json.load(source)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise OverlaySizeConfigError(f"オーバーレイサイズ設定を読み込めません: {error}") from error

    def valid_size(value, allow_unspecified=False):
        if not isinstance(value, dict) or "width" not in value or "height" not in value:
            return False
        width, height = value["width"], value["height"]
        if allow_unspecified and width is None and height is None:
            return True
        return type(width) is int and width > 0 and type(height) is int and height > 0

    if (
        not isinstance(config, dict)
        or type(config.get("schema")) is not int
        or config["schema"] != 1
        or not valid_size(config.get("default"))
        or not isinstance(config.get("overlays"), list)
    ):
        raise OverlaySizeConfigError("オーバーレイサイズ設定の形式が不正です。")

    filenames = set()
    for overlay in config["overlays"]:
        if not isinstance(overlay, dict):
            raise OverlaySizeConfigError("オーバーレイサイズの項目が不正です。")
        filename = overlay.get("file")
        description = overlay.get("description")
        if (
            not isinstance(filename, str)
            or not filename.endswith(".html")
            or any(character in filename for character in "/\\`\r\n")
            or filename.casefold() in filenames
            or not valid_size(overlay, allow_unspecified=True)
            or not isinstance(description, str)
            or "\n" in description
            or "\r" in description
        ):
            raise OverlaySizeConfigError("オーバーレイサイズの項目が不正です。")
        filenames.add(filename.casefold())
    return config


def get_overlay_size(path, filename):
    config = load_overlay_sizes(path)
    size = next((item for item in config["overlays"] if item["file"] == filename), None)
    if size is None or size["width"] is None:
        size = config["default"]
    return size["width"], size["height"]
