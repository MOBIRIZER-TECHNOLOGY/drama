"""Validate the five imported series and every publicly hosted seed media file."""

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

# Importing the packer also applies its Python floor, so an old interpreter is named rather than
# surfacing later as a missing attribute.
from pack import ROOT, verify, write_json


def fetch(url, post=False):
    request = Request(
        url, data=b"{}" if post else None, headers={"Content-Type": "application/json"}
    )
    with urlopen(request, timeout=30) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://localhost:8000")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.report.resolve().is_relative_to(ROOT):
        parser.error("Save the validation report outside the immutable share pack")
    seed, manifest = verify(ROOT)
    report = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "api_url": args.api_url,
        "series": [],
    }
    cdn_root = None
    for item in seed["series"]:
        detail = json.loads(fetch(f"{args.api_url}/v1/series/{item['slug']}"))
        assert detail["title"] == item["title"]
        assert item["attribution"] in detail["synopsis"]
        assert [episode["number"] for episode in detail["episodes"]] == list(
            range(1, 6)
        )
        episodes = []
        # Paired by position, so the counts have to match first; `zip(strict=True)` would say this in one
        # word but arrived in 3.10, and this file runs on whatever `python3` the recipient has.
        assert len(item["episodes"]) == len(detail["episodes"]), item["slug"]
        for expected, episode in zip(item["episodes"], detail["episodes"]):
            assert (
                episode["is_free"] and episode["accessible"] and episode["price"] == 0
            )
            assert (
                episode["title"] == expected["title"]
                and episode["duration_sec"] == expected["duration_sec"]
            )
            grant = json.loads(
                fetch(f"{args.api_url}/v1/episodes/{episode['id']}/play", post=True)
            )
            key = seed["storage_prefix"] + "/" + expected["hls_master_path"]
            assert key in grant["hls_url"]
            master = fetch(grant["hls_url"])
            assert (
                hashlib.sha256(master).hexdigest()
                == manifest["files"][expected["hls_master_path"]]["sha256"]
            )
            cdn_root = grant["hls_url"].split(key, 1)[0]
            episodes.append(
                {
                    "id": episode["id"],
                    "number": episode["number"],
                    "duration_sec": episode["duration_sec"],
                }
            )
        report["series"].append(
            {"slug": item["slug"], "id": detail["id"], "episodes": episodes}
        )
        print(f"Verified 5 free playback grants: {item['slug']}", flush=True)
    checked = 0
    for key, expected in manifest["files"].items():
        if key.startswith("media/"):
            media = fetch(cdn_root + seed["storage_prefix"] + "/" + key)
            assert (
                len(media) == expected["size_bytes"]
                and hashlib.sha256(media).hexdigest() == expected["sha256"]
            ), key
            checked += 1
    credits = fetch(f"{args.api_url}/v1/pages/film-credits").decode()
    for item in seed["series"]:
        assert item["license_url"] in credits and item["rights_url"] in credits
    report["public_media_files_verified"] = checked
    report["credits_verified"] = True
    args.report.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.report, report)
    print(
        f"Passed: 25 free playback grants and {checked} public file hashes; {args.report}"
    )


if __name__ == "__main__":
    main()
