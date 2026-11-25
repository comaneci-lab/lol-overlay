import json
import subprocess
import sys
from pathlib import Path

from write_app_update_manifest import COMMIT_PATTERN, VERSION_PATTERN


ROOT = Path(__file__).resolve().parents[1]


def git_output(*arguments):
    try:
        result = subprocess.run(
            ["git", *arguments],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip()


def required_git_output(*arguments):
    result = subprocess.run(
        ["git", *arguments],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def interactive_version():
    choice = input("ビルド種別を選択してください（1: 開発版、2: リリース版）: ").strip()
    if choice == "1":
        return "開発版", required_git_output("rev-parse", "HEAD")
    if choice != "2":
        raise ValueError("1 または 2 を入力してください。")

    version = input("リリースタグを入力してください（例: v0.7.1）: ").strip()
    if VERSION_PATTERN.fullmatch(version) is None:
        raise ValueError("タグは v0.7.1 または 0.7.1 の形式で入力してください。")

    if required_git_output("status", "--porcelain", "--untracked-files=normal"):
        raise ValueError("未コミットの変更があります。リリース前にコミットしてください。")
    commit_sha = required_git_output("rev-parse", "HEAD")
    if required_git_output("tag", "--list", version):
        tagged_commit = required_git_output(
            "rev-parse", "--verify", f"refs/tags/{version}^{{commit}}"
        )
        if tagged_commit != commit_sha:
            raise ValueError(f"タグ {version} は別のコミットに存在します。")
        print(f"現在のコミットにあるタグ {version} を使用します。")
    else:
        required_git_output("tag", version)
        print(f"ローカルタグ {version} を作成しました。")
    print(f"ビルド成功後にタグ {version} を origin に push します。")
    return version, commit_sha


def push_build_tag():
    version_path = ROOT / "build" / "app_version.json"
    with version_path.open(encoding="utf-8") as version_file:
        build_info = json.load(version_file)
    if not isinstance(build_info, dict):
        raise ValueError("ビルド情報の形式が不正です。")

    version = build_info.get("version")
    if version == "開発版":
        print("開発版のため、タグの push は行いません。")
        return
    commit_sha = build_info.get("commit_sha")
    if not isinstance(version, str) or VERSION_PATTERN.fullmatch(version) is None:
        raise ValueError("ビルド情報のタグが不正です。")
    if not isinstance(commit_sha, str) or COMMIT_PATTERN.fullmatch(commit_sha) is None:
        raise ValueError("ビルド情報のコミットが不正です。")
    if required_git_output("status", "--porcelain", "--untracked-files=normal"):
        raise ValueError("ビルド中に未コミットの変更が発生したため、タグを push できません。")
    if required_git_output("rev-parse", "HEAD") != commit_sha:
        raise ValueError("ビルド後に現在のコミットが変更されたため、タグを push できません。")
    tagged_commit = required_git_output(
        "rev-parse", "--verify", f"refs/tags/{version}^{{commit}}"
    )
    if tagged_commit != commit_sha:
        raise ValueError(f"タグ {version} がビルド対象のコミットを指していません。")

    subprocess.run(
        ["git", "push", "origin", f"refs/tags/{version}:refs/tags/{version}"],
        cwd=ROOT,
        check=True,
    )
    print(f"タグ {version} を origin に push しました。")


def main():
    if sys.argv[1:] == ["--push-tag"]:
        try:
            push_build_tag()
        except (ValueError, OSError, subprocess.CalledProcessError) as error:
            if isinstance(error, subprocess.CalledProcessError):
                detail = (error.stderr or "").strip() or str(error)
            else:
                detail = str(error)
            print(f"タグを push できませんでした: {detail}", file=sys.stderr)
            raise SystemExit(1) from error
        return

    if sys.argv[1:] == ["--interactive"]:
        output_path = ROOT / "build" / "app_version.json"
        try:
            version, commit_sha = interactive_version()
        except (ValueError, EOFError, OSError, subprocess.CalledProcessError) as error:
            if isinstance(error, subprocess.CalledProcessError):
                detail = error.stderr.strip() or str(error)
            elif isinstance(error, EOFError):
                detail = "入力が終了しました。"
            else:
                detail = str(error)
            print(f"ビルドを中止しました: {detail}", file=sys.stderr)
            raise SystemExit(1) from error
    else:
        output_path = (
            Path(sys.argv[1])
            if len(sys.argv) > 1
            else ROOT / "build" / "app_version.json"
        )
        version = git_output("describe", "--tags", "--exact-match", "HEAD") or "開発版"
        commit_sha = git_output("rev-parse", "HEAD") or "unknown"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps({"version": version, "commit_sha": commit_sha}),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
