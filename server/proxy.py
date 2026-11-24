#!/usr/bin/env python3
"""Static server for Crizsopha, plus a same-origin fallback proxy.

The browser normally calls https://api.bitbucket.org directly.
If that is blocked, the page retries /bitbucket/* on this process.
The token is forwarded and never written to disk or to the log.
"""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 8765
UPSTREAM = "https://api.bitbucket.org"
ALLOWED = {".html", ".css", ".js", ".svg", ".json", ".ico", ".txt"}
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def do_HEAD(self):
        self._route(head=True)

    def do_GET(self):
        self._route(head=False)

    def do_OPTIONS(self):
        self.send_response(204)
        self._extra_headers()
        self.end_headers()

    def _extra_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")

    def _send(self, status, body, content_type, head):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self._extra_headers()
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def _route(self, head):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._send(200, b'{"ok":true,"service":"crizsopha"}', "application/json", head)
            return
        if path == "/bitbucket" or path.startswith("/bitbucket/"):
            self._proxy(head)
            return
        self._static(path, head)

    def _proxy(self, head):
        upstream = UPSTREAM + self.path[len("/bitbucket"):]
        if not upstream.startswith(UPSTREAM + "/"):
            self._send(400, b'{"error":{"message":"caminho invalido"}}', "application/json", head)
            return
        headers = {"Accept": "application/json", "User-Agent": "crizsopha-local"}
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth
        request = Request(upstream, headers=headers, method="GET")
        try:
            with urlopen(request, timeout=60) as response:
                body = response.read()
                content_type = response.headers.get("Content-Type", "application/json")
                self._send(response.status, body, content_type, head)
        except HTTPError as error:
            body = error.read()
            content_type = error.headers.get("Content-Type", "application/json")
            self._send(error.code, body, content_type, head)
        except URLError as error:
            payload = json.dumps({"error": {"message": str(error.reason)}}).encode("utf-8")
            self._send(502, payload, "application/json", head)

    def _static(self, path, head):
        relative = "index.html" if path in ("", "/") else path.lstrip("/")
        candidate = (ROOT / relative).resolve()
        if ROOT not in candidate.parents and candidate != ROOT:
            self._send(403, b"forbidden", "text/plain; charset=utf-8", head)
            return
        if not candidate.is_file() or candidate.suffix.lower() not in ALLOWED:
            self._send(404, b"not found", "text/plain; charset=utf-8", head)
            return
        self._send(200, candidate.read_bytes(), MIME.get(candidate.suffix.lower(), "application/octet-stream"), head)


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    server = Server((HOST, PORT), Handler)
    print("Crizsopha em http://%s:%s/" % (HOST, PORT))
    print("Ctrl+C encerra. O token nao e gravado aqui.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nencerrado")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
