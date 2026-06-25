"""
Stateless web service for the CMA tool (cloud deployment).

Serves the static frontend in web/ and exposes:
  * POST /api/parse — takes an uploaded MLS PDF (raw bytes) and returns parsed
    JSON plus property photos and full page-renders as base64 data URIs.
  * Admin user-management endpoints (admins only):
      GET    /api/admin/users        — list agent accounts
      POST   /api/admin/users        — create an agent  {email, password}
      DELETE /api/admin/users/{uid}  — delete an agent

The parse endpoint holds NO state and needs NO Supabase keys. The admin
endpoints use the Supabase service-role key, read ONLY from the environment
(SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and NEVER from the repo. Every admin
request verifies the caller's access token AND that they are an admin before
acting. When the env vars are absent the admin endpoints report 503 and the rest
of the service (static hosting + /api/parse) runs exactly as before, so this
still works locally with no keys.

Run locally:  python service.py   (PORT defaults to 8000)
"""

import os
import json
import mimetypes
import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error

import fitz  # PyMuPDF
from cma import parser, media

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
MAX_UPLOAD = 60 * 1024 * 1024  # 60 MB safety cap (PDFs with photos are larger)

# Admin API config — set ONLY in the Render environment, never in the repo. The
# service-role key bypasses RLS, so it lives server-side and is never sent to the
# browser. Without these, the admin endpoints return 503 "not configured".
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


class ApiError(Exception):
    """An error to surface to the caller with a specific HTTP status code."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _sb_request(method, path, token=None, apikey=None, body=None, query=None):
    """Call Supabase; return (status, parsed_json_or_None). Raises ApiError on
    a transport failure (so callers don't have to distinguish those)."""
    url = SUPABASE_URL + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if apikey:
        req.add_header("apikey", apikey)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = {"error": raw.decode("utf-8", "replace")}
        return e.code, parsed
    except urllib.error.URLError:
        raise ApiError(502, "Could not reach the authentication service.")


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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, apikey, X-Client-Info")

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            return b""
        if length > MAX_UPLOAD:
            raise ValueError("File is too large.")
        return self.rfile.read(length)

    def _read_json_body(self):
        raw = self._read_body()
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            raise ApiError(400, "Invalid request body.")

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

    # ---- admin API --------------------------------------------------------
    def _require_admin(self):
        """Verify the caller's bearer token and confirm they are an admin.
        Returns the caller's user id, or raises ApiError. NEVER trusts any
        client-supplied "is admin" flag — it checks the database server-side."""
        if not (SUPABASE_URL and SERVICE_ROLE_KEY):
            raise ApiError(503, "Admin tools are not configured on the server yet.")
        auth = self.headers.get("Authorization", "")
        token = auth[7:].strip() if auth[:7].lower() == "bearer " else ""
        if not token:
            raise ApiError(401, "Please sign in again.")
        # 1) Who is calling? Verify their access token against Supabase.
        status, user = _sb_request("GET", "/auth/v1/user", token=token, apikey=SERVICE_ROLE_KEY)
        if status != 200 or not isinstance(user, dict) or not user.get("id"):
            raise ApiError(401, "Your session has expired — please sign in again.")
        uid = user["id"]
        # 2) Are they an admin? (service role bypasses RLS to read the flag.)
        status, rows = _sb_request(
            "GET", "/rest/v1/profiles",
            token=SERVICE_ROLE_KEY, apikey=SERVICE_ROLE_KEY,
            query={"id": "eq." + uid, "select": "is_admin"},
        )
        if status != 200 or not isinstance(rows, list) or not rows or not rows[0].get("is_admin"):
            raise ApiError(403, "Only an admin can manage agents.")
        return uid

    def _admin_list_users(self):
        users, page = [], 1
        while True:
            status, data = _sb_request(
                "GET", "/auth/v1/admin/users",
                token=SERVICE_ROLE_KEY, apikey=SERVICE_ROLE_KEY,
                query={"page": page, "per_page": 200},
            )
            if status != 200:
                raise ApiError(502, "Could not list agents.")
            batch = data.get("users") if isinstance(data, dict) else (data or [])
            if not batch:
                break
            users.extend(batch)
            if len(batch) < 200:
                break
            page += 1
        return [
            {
                "id": u.get("id"),
                "email": u.get("email"),
                "created_at": u.get("created_at"),
                "last_sign_in_at": u.get("last_sign_in_at"),
            }
            for u in users
        ]

    def _admin_create_user(self, email, password):
        status, data = _sb_request(
            "POST", "/auth/v1/admin/users",
            token=SERVICE_ROLE_KEY, apikey=SERVICE_ROLE_KEY,
            body={"email": email, "password": password, "email_confirm": True},
        )
        if status not in (200, 201) or not isinstance(data, dict) or not data.get("id"):
            msg = ""
            if isinstance(data, dict):
                msg = (data.get("msg") or data.get("error_description")
                       or data.get("error") or data.get("message") or "")
            raise ApiError(400, msg or "Could not create that agent.")
        return {"id": data.get("id"), "email": data.get("email")}

    def _admin_delete_user(self, uid):
        status, _ = _sb_request(
            "DELETE", "/auth/v1/admin/users/" + urllib.parse.quote(uid),
            token=SERVICE_ROLE_KEY, apikey=SERVICE_ROLE_KEY,
        )
        if status not in (200, 204):
            raise ApiError(400, "Could not delete that agent.")

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
            if self.path == "/api/admin/users":
                self._require_admin()
                body = self._read_json_body()
                email = (body.get("email") or "").strip()
                password = body.get("password") or ""
                if not email or not password:
                    raise ApiError(400, "An email and a temporary password are required.")
                user = self._admin_create_user(email, password)
                return self._json({"ok": True, "user": user}, cors=True)
            return self._json({"ok": False, "error": "Unknown endpoint."}, 404, cors=True)
        except ApiError as e:
            return self._json({"ok": False, "error": e.message}, e.status, cors=True)
        except Exception as e:  # never crash the server on a bad request
            return self._json({"ok": False, "error": str(e)}, 400, cors=True)

    def do_DELETE(self):
        try:
            path = self.path.split("?", 1)[0]
            prefix = "/api/admin/users/"
            if path.startswith(prefix):
                uid = path[len(prefix):].strip("/")
                if not uid:
                    raise ApiError(400, "Missing agent id.")
                caller = self._require_admin()
                if uid == caller:
                    raise ApiError(400, "You can't delete your own admin account.")
                self._admin_delete_user(uid)
                return self._json({"ok": True}, cors=True)
            return self._json({"ok": False, "error": "Unknown endpoint."}, 404, cors=True)
        except ApiError as e:
            return self._json({"ok": False, "error": e.message}, e.status, cors=True)
        except Exception as e:
            return self._json({"ok": False, "error": str(e)}, 400, cors=True)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        # Admin: list agents (admins only).
        if path == "/api/admin/users":
            try:
                self._require_admin()
                return self._json({"ok": True, "users": self._admin_list_users()}, cors=True)
            except ApiError as e:
                return self._json({"ok": False, "error": e.message}, e.status, cors=True)
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 400, cors=True)
        # Static frontend.
        try:
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
