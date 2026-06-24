"""
Stateless web service for the CMA tool (cloud deployment).

Serves the static frontend in web/ and exposes POST /api/parse, which takes an
uploaded MLS PDF (raw bytes) and returns the parsed JSON plus the property
photos and full page-renders as base64 data URIs. It holds NO state on disk and
needs NO Supabase keys, so it can run on Render's free tier inside Docker.

Run locally:  python service.py   (PORT defaults to 8000)
"""

import os
import json
import mimetypes
import http.server
import socketserver

import fitz  # PyMuPDF
from cma import parser, media

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
MAX_UPLOAD = 60 * 1024 * 1024  # 60 MB safety cap (PDFs with photos are larger)

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(http.server.BaseHTTPRequestHandler):
    # ---- helpers ----------------------------------------------------------
    def _json(self, obj, status=200, cors=False):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if cors:
            self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            return b""
        if length > MAX_UPLOAD:
            raise ValueError("File is too large.")
        return self.rfile.read(length)

    def _parse_pdf(self, pdf_bytes):
        """Parse the PDF and return data + base64 photos + base64 page renders."""
        if not pdf_bytes:
            raise ValueError("No file was received.")
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        return {
            "data": parser.parse_doc(doc),
            "photos": media.extract_photos_b64(doc),
            "pages": media.render_pages_b64(doc),
            "pageCount": doc.page_count,
        }

    # ---- routing ----------------------------------------------------------
    def do_OPTIONS(self):
        # CORS preflight: production is same-origin, this is insurance.
        self.send_response(204)
        self._cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        try:
            if self.path == "/api/parse":
                return self._json(
                    {"ok": True, **self._parse_pdf(self._read_body())}, cors=True
                )
            return self._json({"ok": False, "error": "Unknown endpoint."}, 404)
        except Exception as e:  # never crash the server on a bad request
            return self._json({"ok": False, "error": str(e)}, 400, cors=True)

    def do_GET(self):
        try:
            path = self.path.split("?", 1)[0]
            if path == "/":
                path = "/index.html"
            rel = os.path.normpath(path).lstrip("\\/")
            full = os.path.abspath(os.path.join(WEB_DIR, rel))
            if not full.startswith(os.path.abspath(WEB_DIR)) or not os.path.isfile(full):
                self.send_error(404, "Not found")
                return
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        except Exception:  # never crash the server on a bad request
            try:
                self.send_error(500, "Server error")
            except Exception:
                pass

    def log_message(self, *args):
        pass  # keep the console clean


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = int(os.environ.get("PORT", "8000"))
    httpd = Server(("0.0.0.0", port), Handler)
    print(f"CMA service listening on 0.0.0.0:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping CMA service.")


if __name__ == "__main__":
    main()
