import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_ROOT = "https://api.github.com/repos/comaneci-lab/lol-overlay"
MANIFEST_NAME = "app-update.json"
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
MAX_RESPONSE_SIZE = 64 * 1024


def fetch_url(url, token=None, accept="application/vnd.github+json"):
    headers = {
        "Accept": accept,
        "User-Agent": "lol-overlay-pages",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(url, headers=headers)
    with urlopen(request, timeout=30) as response:
        content = response.read(MAX_RESPONSE_SIZE + 1)
    if len(content) > MAX_RESPONSE_SIZE:
        raise ValueError(f"GitHub response is too large: {url}")
    return content


def load_latest_release(token, required):
    try:
        release_content = fetch_url(f"{API_ROOT}/releases/latest", token)
    except HTTPError as error:
        if error.code == 404 and not required:
            print("No published application release found; skipping app-update.json.")
            return None
        raise RuntimeError(f"Could not load the latest GitHub Release: HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError(f"Could not load the latest GitHub Release: {error}") from error

    try:
        release = json.loads(release_content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Latest GitHub Release response is invalid JSON.") from error
    if not isinstance(release, dict):
        raise ValueError("Latest GitHub Release response has an invalid shape.")
    return release


def validate_release_manifest(manifest, release):
    if not isinstance(manifest, dict) or type(manifest.get("schema")) is not int:
        raise ValueError("Application update manifest has an invalid schema.")
    if manifest["schema"] != 1:
        raise ValueError("Application update manifest schema is unsupported.")

    tag_name = release.get("tag_name")
    if manifest.get("version") != tag_name or not isinstance(tag_name, str):
        raise ValueError("Application update manifest version does not match the release.")

    if not isinstance(manifest.get("commit_sha"), str) or not COMMIT_PATTERN.fullmatch(
        manifest["commit_sha"]
    ):
        raise ValueError("Application update manifest commit SHA is invalid.")
    if not isinstance(manifest.get("sha256"), str) or not SHA256_PATTERN.fullmatch(
        manifest["sha256"]
    ):
        raise ValueError("Application update manifest SHA-256 is invalid.")
    if manifest.get("release_url") != release.get("html_url"):
        raise ValueError("Application update manifest URL does not match the release.")
    return manifest


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: fetch_latest_app_update_manifest.py OUTPUT_PATH")

    output_path = Path(sys.argv[1])
    required = os.environ.get("REQUIRE_APP_UPDATE_MANIFEST", "").lower() == "true"
    token = os.environ.get("GH_TOKEN")
    release = load_latest_release(token, required)
    if release is None:
        return

    if required:
        expected_tag = os.environ.get("EXPECTED_RELEASE_TAG")
        expected_commit = os.environ.get("EXPECTED_RELEASE_COMMIT")
        if not expected_tag:
            raise ValueError("The published release tag is missing.")
        if release.get("tag_name") != expected_tag:
            raise ValueError("The published release is not the latest release.")
        if not expected_commit or not COMMIT_PATTERN.fullmatch(expected_commit):
            raise ValueError("The checked-out release commit is invalid.")

    matching_assets = [
        asset
        for asset in release.get("assets", [])
        if isinstance(asset, dict) and asset.get("name") == MANIFEST_NAME
    ]
    if len(matching_assets) != 1:
        if required:
            raise ValueError(
                f"Latest release must include exactly one {MANIFEST_NAME} asset."
            )
        print("Latest release has no app-update.json asset; skipping.")
        return

    download_url = matching_assets[0].get("browser_download_url")
    if not isinstance(download_url, str) or not download_url.startswith(
        "https://github.com/comaneci-lab/lol-overlay/releases/download/"
    ):
        raise ValueError("Release app-update.json asset URL is invalid.")

    try:
        manifest_content = fetch_url(
            download_url,
            accept="application/octet-stream",
        )
    except (HTTPError, URLError) as error:
        raise RuntimeError(f"Could not download {MANIFEST_NAME}: {error}") from error
    try:
        manifest = json.loads(manifest_content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{MANIFEST_NAME} asset is invalid JSON.") from error

    manifest = validate_release_manifest(manifest, release)
    if required and manifest["commit_sha"] != expected_commit:
        raise ValueError("Application update manifest commit does not match the release commit.")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Published {MANIFEST_NAME} for {release['tag_name']}.")


if __name__ == "__main__":
    main()
