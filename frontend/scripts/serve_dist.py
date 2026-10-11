"""Serve the built frontend with SPA fallback, mimicking Netlify's CDN.

Used to test the production topology locally: the frontend is served from a
different origin than the API, so CORS is genuinely exercised.

Usage:  python serve_dist.py <dist-dir> <port>
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class SPAHandler(SimpleHTTPRequestHandler):
    """Serves files, falling back to index.html for client-side routes.

    Mirrors the `/* -> /index.html` redirect in netlify.toml.
    """

    def do_GET(self) -> None:  # noqa: N802
        path = self.translate_path(self.path)
        if not Path(path).is_file() and not self.path.startswith("/api"):
            self.path = "/index.html"
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:  # quieter output
        pass


def main() -> int:
    dist = Path(sys.argv[1] if len(sys.argv) > 1 else "dist").resolve()
    port = int(sys.argv[2] if len(sys.argv) > 2 else 5174)

    if not (dist / "index.html").is_file():
        print(f"error: no index.html in {dist}", file=sys.stderr)
        return 1

    handler = partial(SPAHandler, directory=str(dist))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"serving {dist} at http://127.0.0.1:{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())