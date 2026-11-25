import argparse
from pathlib import Path

from scripts.overlay_sizes import load_overlay_sizes


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "overlay_sizes.json"
DOC_PATH = ROOT / "docs" / "OBS設定手順.md"
START = "<!-- OBS_OVERLAY_SIZES_START -->"
END = "<!-- OBS_OVERLAY_SIZES_END -->"


def render_size_section(config):
    default = config["default"]
    lines = [
        f"追加時は下表のサイズを使用し、固定値のないHTMLや表にないHTMLは"
        f"{default['width']}×{default['height']}で追加します。必要に応じてOBSで幅・高さを調整してください。",
        "",
        "| HTMLファイル | 幅 | 高さ | 備考 |",
        "| --- | ---: | ---: | --- |",
    ]
    for overlay in config["overlays"]:
        width = overlay["width"] if overlay["width"] is not None else "固定値なし"
        height = overlay["height"] if overlay["height"] is not None else "固定値なし"
        description = overlay["description"].replace("|", "\\|")
        lines.append(f"| `html/{overlay['file']}` | {width} | {height} | {description} |")
    return "\n".join(lines)


def update_size_section(document, config):
    if document.count(START) != 1 or document.count(END) != 1:
        raise ValueError("OBS設定手順のサイズ表マーカーが不正です。")
    before, remainder = document.split(START)
    old_section, after = remainder.split(END)
    del old_section
    return f"{before}{START}\n{render_size_section(config)}\n{END}{after}"


def main():
    parser = argparse.ArgumentParser(description="OBS設定手順のサイズ表をJSONから生成します。")
    parser.add_argument("--check", action="store_true", help="表が最新か確認します。")
    args = parser.parse_args()
    config = load_overlay_sizes(CONFIG_PATH)
    document = DOC_PATH.read_text(encoding="utf-8")
    updated = update_size_section(document, config)
    if args.check:
        if document != updated:
            parser.exit(1, "OBS設定手順のサイズ表が古くなっています。生成コマンドを実行してください。\n")
        print("OBS設定手順のサイズ表は最新です。")
    else:
        with DOC_PATH.open("w", encoding="utf-8", newline="\n") as target:
            target.write(updated)
        print("OBS設定手順のサイズ表を更新しました。")


if __name__ == "__main__":
    main()
