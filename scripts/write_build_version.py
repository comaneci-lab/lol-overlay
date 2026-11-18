import json
import subprocess
import sys
from pathlib import Path


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


def main():
    output_path = (
        Path(sys.argv[1])
        if len(sys.argv) > 1
        else ROOT / "build" / "app_version.json"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    version = git_output("describe", "--tags", "--exact-match", "HEAD") or "開発版"
    commit_sha = git_output("rev-parse", "HEAD") or "unknown"
    output_path.write_text(
        json.dumps({"version": version, "commit_sha": commit_sha}),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
