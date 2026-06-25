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
import re
import json
import logging
import threading
import mimetypes
import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error

import fitz  # PyMuPDF
from cma import parser, media

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("cma")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
MAX_UPLOAD = 60 * 1024 * 1024  # 60 MB safety cap (PDFs with photos are larger)

# Admin API config — set ONLY in the Render environment, never in the repo. The
# service-role key bypasses RLS, so it lives server-side and is never sent to the
# browser. Without these, the admin endpoints return 503 "not configured".
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if SUPABASE_URL and not SUPABASE_URL.startswith("https://"):
    raise SystemExit("SUPABASE_URL must be an https:// URL (refusing to send keys over cleartext).")

# When Supabase is configured (i.e. in production) the PDF parser is gated behind
# a valid signed-in agent so it can't be used as an open compute/DoS endpoint by
# anyone on the internet. With no keys (pure local dev) it stays open so the tool
# still runs with zero configuration.
AUTH_CONFIGURED = bool(SUPABASE_URL and SERVICE_ROLE_KEY)

# Bound how many heavy PDF parses run at once so a burst can't exhaust memory on
# the small Render instance (each parse renders every page to an image).
try:
    _PARSE_LIMIT = max(1, int(os.environ.get("PARSE_CONCURRENCY", "2")))
except ValueError:
    _PARSE_LIMIT = 2
_PARSE_SEMAPHORE = threading.BoundedSemaphore(_PARSE_LIMIT)

# CORS: production is same-origin, so the browser needs NO cross-origin grant.
# We never use "*" or reflect an arbitrary Origin. Set ALLOWED_ORIGINS
# (comma-separated) only to intentionally permit specific other origins.
ALLOWED_ORIGINS = {o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()}

# Content-Security-Policy for the app shell. Blocks inline/3rd-party SCRIPT (the
# main XSS lever) while allowing the esm.sh module CDN, Supabase, local fonts,
# and the inline styles + data/remote images the app legitimately uses.
CSP = (
    "default-src 'self'; "
    "script-src 'self' https://esm.sh; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https:; "
    "font-src 'self'; "
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://esm.sh; "
    "frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'"
)

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

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
        # Only grant CORS to explicitly allow-listed origins — never "*", and
        # never an arbitrary reflected Origin. Same-origin requests don't need
        # these headers at all, so the default (empty allow-list) is safe.
        origin = self.headers.get("Origin", "")
        if origin and origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, apikey, X-Client-Info")

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0:
            return b""
        if length > MAX_UPLOAD:
            raise ApiError(413, "That file is too large.")
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
        """Parse the PDF and return data + base64 photos + base64 page renders.
        Wraps all PyMuPDF errors in a friendly message so internal details never
        leak to the caller, and always frees the document."""
        if not pdf_bytes:
            raise ApiError(400, "No file was received.")
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        except Exception:
            raise ApiError(400, "Could not read this PDF. Please upload a valid MLS PDF.")
        try:
            return {
                "data": parser.parse_doc(doc),
                "photos": media.extract_photos_b64(doc),
                "pages": media.render_pages_b64(doc),
                "pageCount": doc.page_count,
            }
        except ApiError:
            raise
        except Exception:
            log.exception("PDF parse failed")
            raise ApiError(400, "Could not read this PDF. Please upload a valid MLS PDF.")
        finally:
            try:
                doc.close()
            except Exception:
                pass

    # ---- auth helpers -----------------------------------------------------
    def _bearer_token(self):
        auth = self.headers.get("Authorization", "")
        return auth[7:].strip() if auth[:7].lower() == "bearer " else ""

    def _verify_user_token(self):
        """Verify the caller's Supabase access token and return their user id.
        Any signed-in agent passes (no admin check). Raises ApiError otherwise."""
        if not AUTH_CONFIGURED:
            raise ApiError(503, "Authentication is not configured on the server yet.")
        token = self._bearer_token()
        if not token:
            raise ApiError(401, "Please sign in again.")
        status, user = _sb_request("GET", "/auth/v1/user", token=token, apikey=SERVICE_ROLE_KEY)
        if status != 200 or not isinstance(user, dict) or not user.get("id"):
            raise ApiError(401, "Your session has expired — please sign in again.")
        return user["id"]

    # ---- admin API --------------------------------------------------------
    def _require_admin(self):
        """Verify the caller's bearer token and confirm they are an admin.
        Returns the caller's user id, or raises ApiError. NEVER trusts any
        client-supplied "is admin" flag — it checks the database server-side."""
        # 1) Who is calling? Verify their access token against Supabase.
        uid = self._verify_user_token()
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

    def _admin_set_password(self, uid, password):
        # Set a new (temporary) password, then flag the profile so the agent is
        # forced to choose their own on next login (same as a fresh account).
        status, data = _sb_request(
            "PUT", "/auth/v1/admin/users/" + urllib.parse.quote(uid),
            token=SERVICE_ROLE_KEY, apikey=SERVICE_ROLE_KEY,
            body={"password": password},
        )
        if status not in (200, 201):
            msg = ""
            if isinstance(data, dict):
                msg = (data.get("msg") or data.get("error_description")
                       or data.get("error") or data.get("message") or "")
            raise ApiError(400, msg or "Could not reset that agent's password.")
        status2, _ = _sb_request(
            "PATCH", "/rest/v1/profiles",
            token=SERVICE_ROLE_KEY, apikey=SERVICE_ROLE_KEY,
            query={"id": "eq." + uid},
            body={"must_reset": True},
        )
        if status2 not in (200, 204):
            raise ApiError(502, "Password was reset, but the force-change flag could not be set.")

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
                # In production (keys configured) only signed-in agents may parse,
                # so this can't be abused as an open compute endpoint. Auth is
                # checked BEFORE the (up to 60 MB) body is read.
                if AUTH_CONFIGURED:
                    self._verify_user_token()
                body = self._read_body()
                with _PARSE_SEMAPHORE:  # bound concurrent heavy renders
                    return self._json({"ok": True, **self._parse_pdf(body)}, cors=True)
            if self.path == "/api/admin/users":
                self._require_admin()
                body = self._read_json_body()
                email = (body.get("email") or "").strip()
                password = body.get("password") or ""
                if not email or not password:
                    raise ApiError(400, "An email and a temporary password are required.")
                if not _EMAIL_RE.match(email):
                    raise ApiError(400, "That doesn't look like a valid email address.")
                if len(password) < 8:
                    raise ApiError(400, "Temporary password must be at least 8 characters.")
                user = self._admin_create_user(email, password)
                return self._json({"ok": True, "user": user}, cors=True)
            p = self.path.split("?", 1)[0]
            if p.startswith("/api/admin/users/") and p.endswith("/reset"):
                uid = p[len("/api/admin/users/"):-len("/reset")].strip("/")
                self._require_admin()
                if not _UUID_RE.match(uid):
                    raise ApiError(400, "Invalid agent id.")
                body = self._read_json_body()
                password = body.get("password") or ""
                if len(password) < 8:
                    raise ApiError(400, "Temporary password must be at least 8 characters.")
                self._admin_set_password(uid, password)
                return self._json({"ok": True}, cors=True)
            return self._json({"ok": False, "error": "Unknown endpoint."}, 404, cors=True)
        except ApiError as e:
            return self._json({"ok": False, "error": e.message}, e.status, cors=True)
        except Exception:  # never crash the server, and never leak internals
            log.exception("Unhandled error in POST %s", self.path)
            return self._json({"ok": False, "error": "Something went wrong handling that request."}, 500, cors=True)

    def do_DELETE(self):
        try:
            path = self.path.split("?", 1)[0]
            prefix = "/api/admin/users/"
            if path.startswith(prefix):
                uid = path[len(prefix):].strip("/")
                caller = self._require_admin()
                if not _UUID_RE.match(uid):
                    raise ApiError(400, "Invalid agent id.")
                if uid == caller:
                    raise ApiError(400, "You can't delete your own admin account.")
                self._admin_delete_user(uid)
                return self._json({"ok": True}, cors=True)
            return self._json({"ok": False, "error": "Unknown endpoint."}, 404, cors=True)
        except ApiError as e:
            return self._json({"ok": False, "error": e.message}, e.status, cors=True)
        except Exception:
            log.exception("Unhandled error in DELETE %s", self.path)
            return self._json({"ok": False, "error": "Something went wrong handling that request."}, 500, cors=True)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        # Admin: list agents (admins only).
        if path == "/api/admin/users":
            try:
                self._require_admin()
                return self._json({"ok": True, "users": self._admin_list_users()}, cors=True)
            except ApiError as e:
                return self._json({"ok": False, "error": e.message}, e.status, cors=True)
            except Exception:
                log.exception("Unhandled error in GET %s", self.path)
                return self._json({"ok": False, "error": "Something went wrong handling that request."}, 500, cors=True)
        # Static frontend.
        try:
            if path == "/":
                path = "/index.html"
            rel = os.path.normpath(path).lstrip("\\/")
            web_root = os.path.abspath(WEB_DIR)
            full = os.path.abspath(os.path.join(WEB_DIR, rel))
            # Contain the path to WEB_DIR. The trailing-sep check defeats the
            # sibling-prefix bug (e.g. /app/web vs /app/web-secrets) that a bare
            # startswith(web_root) would allow.
            if not (full == web_root or full.startswith(web_root + os.sep)) or not os.path.isfile(full):
                self.send_error(404, "Not found")
                return
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            with open(full, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            if (ctype or "").startswith("text/html"):
                self.send_header("Content-Security-Policy", CSP)
            self.end_headers()
            self.wfile.write(body)
        except Exception:  # never crash the server on a bad request
            log.exception("Unhandled error serving %s", self.path)
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
