import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
VERSION_PATTERN = re.compile(r"v?\d+\.\d+\.\d+")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")
REPOSITORY = "comaneci-lab/lol-overlay"


def hash_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    executable_path = ROOT / "dist" / "LoLAPIGet.exe"
    version_path = ROOT / "build" / "app_version.json"
    output_path = ROOT / "dist" / "app-update.json"
    if len(sys.argv) > 1:
        executable_path = Path(sys.argv[1])
    if len(sys.argv) > 2:
        version_path = Path(sys.argv[2])
    if len(sys.argv) > 3:
        output_path = Path(sys.argv[3])

    with version_path.open(encoding="utf-8") as version_file:
        build_info = json.load(version_file)
    version = build_info.get("version") if isinstance(build_info, dict) else None
    commit_sha = build_info.get("commit_sha") if isinstance(build_info, dict) else None

    if (
        not isinstance(version, str)
        or VERSION_PATTERN.fullmatch(version) is None
        or not isinstance(commit_sha, str)
        or COMMIT_PATTERN.fullmatch(commit_sha) is None
    ):
        if output_path.exists():
            output_path.unlink()
        print("開発版ビルドのため、app-update.jsonは作成しません。")
        return

    manifest = {
        "schema": 1,
        "version": version,
        "commit_sha": commit_sha,
        "sha256": hash_file(executable_path),
        "release_url": (
            f"https://github.com/{REPOSITORY}/releases/tag/"
            f"{quote(version, safe='')}"
        ),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Application update manifest created: {output_path}")


if __name__ == "__main__":
    main()
