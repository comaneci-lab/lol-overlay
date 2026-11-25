import os
import sys
from pathlib import Path


OVERLAY_EXTENSIONS = {"html": ".html", "css": ".css", "js": ".js"}


def raise_walk_error(error):
    raise error


def check_line_endings(root):
    invalid_paths = []
    for directory, extension in OVERLAY_EXTENSIONS.items():
        base = root / directory
        if not base.is_dir():
            raise OSError(f"ディレクトリが見つかりません: {base}")
        for current, subdirectories, filenames in os.walk(base, onerror=raise_walk_error):
            current_path = Path(current)
            if directory == "css" and current_path == base:
                subdirectories[:] = [name for name in subdirectories if name != "custom"]
            for filename in sorted(filenames):
                path = current_path / filename
                if path.suffix.lower() == extension and b"\r" in path.read_bytes():
                    invalid_paths.append(path.relative_to(root).as_posix())
    return sorted(invalid_paths)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: check_overlay_line_endings.py ROOT")
    try:
        invalid_paths = check_line_endings(Path(sys.argv[1]))
    except OSError as error:
        print(f"改行コードを確認できませんでした: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    if invalid_paths:
        print("次のファイルをLF改行に変換してください:", file=sys.stderr)
        for path in invalid_paths:
            print(f"  {path}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
