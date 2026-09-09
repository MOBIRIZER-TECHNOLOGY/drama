"""Static media host for local development, faithful enough to the edge to test against.

`python -m http.server` is the obvious way to serve the seeded covers and HLS ladders, and it is wrong in two
ways that only show up in a browser:

  * No CORS. `infra/nginx/media.conf` sets `Access-Control-Allow-Origin` on every media response, because a
    player fetching segments cross-origin needs it. Without it the manifest loads (that comes from the API,
    which does send CORS) and every segment fails with a bare `net::ERR_FAILED` — no mention of CORS anywhere
    in the console, so it reads as a broken stream rather than a broken server.
  * No Range. `SimpleHTTPRequestHandler` answers every request with the whole file and status 200, so seeking
    inside a video silently re-downloads from the start, and any player that requires a 206 gives up.

Native apps notice neither: ExoPlayer and AVPlayer are not bound by CORS, and both tolerate a server without
Range. So the mobile build plays perfectly against `http.server` while the web player is dead, and the
difference looks like a bug in the web player.

Usage:
    python scripts/serve-media.py --directory ref/videos --port 8090
"""

import argparse
import functools
import http.server
import os
import re
import socketserver
import sys
from pathlib import Path

RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


class MediaHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler plus the two things a browser-based player needs."""

    def end_headers(self) -> None:
        # Mirrors infra/nginx/media.conf. `*` is right for both: media URLs carry their own signature, so the
        # origin is not what authorises the request.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length,Content-Range,Accept-Ranges")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802 - the name is fixed by BaseHTTPRequestHandler
        self.send_response(204)
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def send_head(self):
        """Answer a `Range` request with 206 and the requested slice; everything else falls through."""
        header = self.headers.get("Range")
        if not header:
            return super().send_head()

        match = RANGE_RE.match(header.strip())
        if match is None:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, "rb")  # noqa: SIM115 - the caller closes it, as in the base class
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(f.fileno()).st_size
        start_raw, end_raw = match.group(1), match.group(2)
        if start_raw == "":
            # `bytes=-500` means the last 500 bytes.
            if end_raw == "":
                f.close()
                self.send_error(400, "Malformed Range header")
                return None
            length = min(int(end_raw), size)
            start, end = size - length, size - 1
        else:
            start = int(start_raw)
            end = int(end_raw) if end_raw else size - 1
            end = min(end, size - 1)

        if start >= size or start > end:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        # The base class copies to the end of the file, so hand back only the slice.
        return _Slice(f, end - start + 1)

    def log_message(self, fmt: str, *args) -> None:
        # One line per segment is thousands of lines per episode; keep the failures.
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class _Slice:
    """A read-only view of `length` bytes from the current position, so `copyfile` stops at the range end."""

    def __init__(self, fp, length: int) -> None:
        self._fp = fp
        self._left = length

    def read(self, size: int = -1) -> bytes:
        if self._left <= 0:
            return b""
        want = self._left if size < 0 else min(size, self._left)
        chunk = self._fp.read(want)
        self._left -= len(chunk)
        return chunk

    def close(self) -> None:
        self._fp.close()


class Server(socketserver.ThreadingTCPServer):
    # A player opens several connections at once (manifest, key, segments across renditions); single-threaded
    # serving deadlocks the page while one segment is in flight.
    daemon_threads = True
    allow_reuse_address = True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", default="ref/videos")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument("--bind", default="0.0.0.0")  # noqa: S104 - a phone on the LAN has to reach it
    args = parser.parse_args()

    root = Path(args.directory).resolve()
    if not root.is_dir():
        print(f"No such directory: {root}")
        return 1

    handler = functools.partial(MediaHandler, directory=str(root))
    with Server((args.bind, args.port), handler) as httpd:
        print(f"Serving {root} on http://{args.bind}:{args.port} (CORS + Range)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
