"""Verify the imported open films through the public API and hash every public media object."""

import argparse
import hashlib
import json
from datetime import UTC, datetime

import httpx
from prepare_open_films import CATALOG_PATH, MANIFEST_PATH, REPO


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    catalog = json.loads(CATALOG_PATH.read_text())
    manifest = json.loads(MANIFEST_PATH.read_text())
    films = {film["slug"]: film for film in catalog["films"]}
    report = {"checked_at": datetime.now(UTC).isoformat(), "api_url": args.api_url, "films": []}
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        for asset in manifest["films"]:
            slug = asset["slug"]
            detail = client.get(f"{args.api_url}/v1/series/{slug}")
            detail.raise_for_status()
            series = detail.json()
            assert series["title"] == films[slug]["title"], f"Wrong title: {slug}"
            assert films[slug]["attribution"] in series["synopsis"], f"Missing attribution: {slug}"
            assert len(series["episodes"]) == 1, f"Expected one complete film: {slug}"
            episode = series["episodes"][0]
            assert episode["is_free"] and episode["price"] == 0 and episode["accessible"], f"Film is locked: {slug}"
            assert episode["duration_sec"] == asset["duration_sec"], f"Wrong runtime: {slug}"
            grant = client.post(f"{args.api_url}/v1/episodes/{episode['id']}/play")
            grant.raise_for_status()
            master_url = grant.json()["hls_url"]
            master = client.get(master_url)
            master.raise_for_status()
            for label in asset["renditions"]:
                assert f"{label}/index.m3u8" in master.text, f"Missing rendition: {slug} {label}"
            for field in ("cover_url", "banner_url"):
                client.get(series[field]).raise_for_status()
            assert asset["hls_master_key"] in master_url, f"Unexpected playback URL: {slug}"
            root_url = master_url.split(asset["hls_master_key"], 1)[0]
            checked = 0
            for key, expected in asset["objects"].items():
                response = client.get(root_url + key)
                response.raise_for_status()
                assert hashlib.sha256(response.content).hexdigest() == expected, f"Media checksum mismatch: {key}"
                checked += 1
            report["films"].append(
                {
                    "slug": slug,
                    "series_id": series["id"],
                    "episode_id": episode["id"],
                    "duration_sec": episode["duration_sec"],
                    "public_objects_verified": checked,
                    "anonymous_playback_grant": True,
                    "renditions": list(asset["renditions"]),
                }
            )
            print(f"Verified {slug}: free playback, {checked} public objects, correct metadata", flush=True)
        credits = client.get(f"{args.api_url}/v1/pages/film-credits")
        credits.raise_for_status()
        for film in films.values():
            assert film["title"] in credits.text and film["rights_url"] in credits.text
        assert catalog["license_url"] in credits.text
        footer = client.get(f"{args.api_url}/v1/pages")
        footer.raise_for_status()
        assert "film-credits" in footer.text
    report["credits_page_verified"] = True
    output = REPO / "review/open-films/api-validation.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Passed; report: {output.relative_to(REPO)}")


if __name__ == "__main__":
    main()
