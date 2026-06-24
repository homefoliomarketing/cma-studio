"""
Local web server for the CMA tool.

Runs entirely on the realtor's own computer. Uses only the Python standard
library plus PyMuPDF (already installed) -- nothing else to install.

  * Serves the app's web pages to the browser.
  * POST /api/parse  -> reads an uploaded MLS PDF (raw bytes) and returns clean
                        structured data as JSON.
  * GET/POST/DELETE /api/cma[...]       -> save / list / open / delete saved CMAs
  * GET/POST /api/settings              -> load / save adjustment presets & branding

Start it by double-clicking "Start CMA.bat", or run:  python server.py
"""

import os
import sys
import json
import uuid
import socket
import shutil
import threading
import webbrowser
import mimetypes
import http.server
import socketserver

import fitz  # PyMuPDF
from cma import parser, media

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
DATA_DIR = os.path.join(BASE_DIR, "data")
CMA_DIR = os.path.join(DATA_DIR, "cmas")
UPLOADS_DIR = os.path.join(DATA_DIR, "uploads")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")
MAX_UPLOAD = 60 * 1024 * 1024  # 60 MB safety cap (PDFs with photos are larger)

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

for d in (DATA_DIR, CMA_DIR, UPLOADS_DIR):
    os.makedirs(d, exist_ok=True)


def _safe_id(name):
    """Keep only safe characters so a CMA id can't escape the data folder."""
    keep = "-_."
    cleaned = "".join(c for c in str(name) if c.isalnum() or c in keep)
    return cleaned[:120] or "untitled"


class Handler(http.server.BaseHTTPRequestHandler):
    # ---- helpers ----------------------------------------------------------
    def _json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            return b""
        if length > MAX_UPLOAD:
            raise ValueError("File is too large.")
        return self.rfile.read(length)

    def _handle_upload(self, pdf_bytes):
        """Store the PDF, read page 1, extract photos, render every page."""
        if not pdf_bytes:
            raise ValueError("No file was received.")
        uid = uuid.uuid4().hex[:16]
        out_dir = os.path.join(UPLOADS_DIR, uid)
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "original.pdf"), "wb") as f:
            f.write(pdf_bytes)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        data = parser.parse_doc(doc)
        photos = media.extract_photos(doc, out_dir)
        pages = media.render_pages(doc, out_dir)
        base = f"/api/media/{uid}/"
        return {
            "uploadId": uid,
            "data": data,
            "photos": [base + p for p in photos],
            "pages": [base + p for p in pages],
            "pageCount": doc.page_count,
        }

    # ---- routing ----------------------------------------------------------
    def do_POST(self):
        try:
            if self.path == "/api/parse":
                data = self._read_body()
                return self._json({"ok": True, "data": parser.parse_bytes(data)})

            if self.path == "/api/upload":
                return self._json({"ok": True, **self._handle_upload(self._read_body())})

            if self.path == "/api/cma":
                payload = json.loads(self._read_body() or b"{}")
                cma_id = _safe_id(payload.get("id") or "untitled")
                payload["id"] = cma_id
                with open(os.path.join(CMA_DIR, cma_id + ".json"), "w", encoding="utf-8") as f:
                    json.dump(payload, f, indent=2, ensure_ascii=False)
                return self._json({"ok": True, "id": cma_id})

            if self.path == "/api/settings":
                payload = json.loads(self._read_body() or b"{}")
                with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                    json.dump(payload, f, indent=2, ensure_ascii=False)
                return self._json({"ok": True})

            return self._json({"ok": False, "error": "Unknown endpoint."}, 404)
        except Exception as e:  # never crash the server on a bad request
            return self._json({"ok": False, "error": str(e)}, 400)

    def do_DELETE(self):
        try:
            if self.path.startswith("/api/cma/"):
                cma_id = _safe_id(self.path[len("/api/cma/"):])
                fp = os.path.join(CMA_DIR, cma_id + ".json")
                if os.path.isfile(fp):
                    os.remove(fp)
                return self._json({"ok": True})
            return self._json({"ok": False, "error": "Unknown endpoint."}, 404)
        except Exception as e:
            return self._json({"ok": False, "error": str(e)}, 400)

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        # --- API: list saved CMAs ---
        if path == "/api/cma":
            items = []
            for fn in sorted(os.listdir(CMA_DIR)):
                if fn.endswith(".json"):
                    try:
                        with open(os.path.join(CMA_DIR, fn), encoding="utf-8") as f:
                            d = json.load(f)
                        items.append({
                            "id": d.get("id", fn[:-5]),
                            "title": d.get("title") or d.get("subject", {}).get("address", "Untitled"),
                            "savedAt": d.get("savedAt"),
                        })
                    except Exception:
                        pass
            return self._json({"ok": True, "items": items})

        # --- API: open one saved CMA ---
        if path.startswith("/api/cma/"):
            cma_id = _safe_id(path[len("/api/cma/"):])
            fp = os.path.join(CMA_DIR, cma_id + ".json")
            if os.path.isfile(fp):
                with open(fp, encoding="utf-8") as f:
                    return self._json({"ok": True, "data": json.load(f)})
            return self._json({"ok": False, "error": "Not found."}, 404)

        # --- API: load settings ---
        if path == "/api/settings":
            if os.path.isfile(SETTINGS_FILE):
                with open(SETTINGS_FILE, encoding="utf-8") as f:
                    return self._json({"ok": True, "data": json.load(f)})
            return self._json({"ok": True, "data": None})

        # --- API: serve an extracted photo / rendered page image ---
        if path.startswith("/api/media/"):
            parts = path[len("/api/media/"):].split("/")
            if len(parts) == 2:
                uid, fn = _safe_id(parts[0]), _safe_id(parts[1])
                fp = os.path.join(UPLOADS_DIR, uid, fn)
                if os.path.isfile(fp):
                    ctype = mimetypes.guess_type(fp)[0] or "application/octet-stream"
                    with open(fp, "rb") as f:
                        body = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            self.send_error(404, "Not found")
            return

        # --- static files ---
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

    def log_message(self, *args):
        pass  # keep the console clean for non-technical users


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def _find_port(start=8765):
    for port in range(start, start + 80):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


def _open_in_chrome(url):
    """Open the app in Chrome if we can find it, otherwise the default browser."""
    candidates = [
        shutil.which("chrome"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            try:
                webbrowser.register("chrome", None, webbrowser.BackgroundBrowser(path))
                webbrowser.get("chrome").open(url)
                return
            except Exception:
                break
    webbrowser.open(url)


def main():
    args = sys.argv[1:]
    no_open = "--no-open" in args
    port_args = [a for a in args if a.isdigit()]
    port = int(port_args[0]) if port_args else _find_port()

    url = f"http://127.0.0.1:{port}/"
    httpd = Server(("127.0.0.1", port), Handler)

    print("=" * 56)
    print("   CMA Software is running.")
    print(f"   Open in your browser:  {url}")
    print("")
    print("   KEEP THIS WINDOW OPEN while you use the app.")
    print("   Close this window when you're done to stop the app.")
    print("=" * 56)

    if not no_open:
        threading.Timer(0.8, lambda: _open_in_chrome(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping CMA Software. Goodbye!")


if __name__ == "__main__":
    main()
