"""
Security tests for the cloud service (service.py).

These boot the real service.py HTTP handler in-process and hit it over HTTP, so
they exercise the ACTUAL request path — auth gating, admin authorization, input
validation, path-traversal containment, error sanitization, CORS and the CSP
header — not a mock of it. Supabase is stubbed (we replace service._sb_request)
so no network or real keys are needed.

Run:  python -m unittest discover -s tests
"""
import json
import os
import threading
import unittest
import urllib.error
import urllib.request

# Configure auth BEFORE importing service so AUTH_CONFIGURED is True and the
# parse/admin endpoints enforce a signed-in caller (production behaviour).
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-role-key"

import fitz  # noqa: E402  (PyMuPDF, used to build a tiny valid PDF)
import service  # noqa: E402

# --- Stub Supabase --------------------------------------------------------
ADMIN_UID = "11111111-1111-1111-1111-111111111111"
USER_UID = "22222222-2222-2222-2222-222222222222"
OTHER_UID = "33333333-3333-3333-3333-333333333333"
TOKENS = {"admintok": ADMIN_UID, "usertok": USER_UID}
IS_ADMIN = {ADMIN_UID: True, USER_UID: False}


def fake_sb_request(method, path, token=None, apikey=None, body=None, query=None):
    if path == "/auth/v1/user":
        uid = TOKENS.get(token)
        return (200, {"id": uid}) if uid else (401, {"msg": "bad token"})
    if path == "/rest/v1/profiles" and method == "GET":
        uid = (query or {}).get("id", "").replace("eq.", "")
        return 200, [{"is_admin": IS_ADMIN.get(uid, False)}]
    if path == "/auth/v1/admin/users" and method == "GET":
        return 200, {"users": [{"id": OTHER_UID, "email": "someone@x.com"}]}
    if path == "/auth/v1/admin/users" and method == "POST":
        return 200, {"id": OTHER_UID, "email": (body or {}).get("email")}
    if path.startswith("/auth/v1/admin/users/") and method == "DELETE":
        return 204, None
    if path.startswith("/auth/v1/admin/users/") and method == "PUT":
        return 200, {"id": OTHER_UID}
    if path == "/rest/v1/profiles" and method == "PATCH":
        return 204, None
    return 200, None


def make_pdf(pages=1):
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"Page {i}")
    raw = doc.tobytes()
    doc.close()
    return raw


def request(method, port, path, token=None, body=None, headers=None, raw=None):
    url = f"http://127.0.0.1:{port}{path}"
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


class ServiceSecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        service._sb_request = fake_sb_request  # stub Supabase
        cls.httpd = service.Server(("127.0.0.1", 0), service.Handler)
        cls.port = cls.httpd.socket.getsockname()[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def j(self, body):
        return json.loads(body.decode())

    # ---- /api/parse auth gating (open-endpoint DoS fix) ------------------
    def test_parse_requires_auth_when_configured(self):
        status, _, body = request("POST", self.port, "/api/parse", raw=make_pdf())
        self.assertEqual(status, 401)
        self.assertFalse(self.j(body)["ok"])

    def test_parse_allows_any_signed_in_agent(self):
        status, _, body = request("POST", self.port, "/api/parse", token="usertok", raw=make_pdf())
        self.assertEqual(status, 200)
        out = self.j(body)
        self.assertTrue(out["ok"])
        self.assertIn("data", out)
        self.assertEqual(out["pageCount"], 1)

    def test_parse_bad_pdf_returns_friendly_error_no_internals(self):
        status, _, body = request("POST", self.port, "/api/parse", token="usertok", raw=b"this is not a pdf")
        self.assertEqual(status, 400)
        msg = self.j(body)["error"]
        self.assertIn("PDF", msg)
        # Must NOT leak internals (stack traces, library names, file paths).
        for leak in ("Traceback", "fitz", "mupdf", "/app/", "Exception"):
            self.assertNotIn(leak, msg)

    # ---- admin authorization (privilege boundary) -----------------------
    def test_admin_list_requires_bearer(self):
        status, _, body = request("GET", self.port, "/api/admin/users")
        self.assertEqual(status, 401)

    def test_admin_list_rejects_non_admin(self):
        status, _, body = request("GET", self.port, "/api/admin/users", token="usertok")
        self.assertEqual(status, 403)
        self.assertIn("admin", self.j(body)["error"].lower())

    def test_admin_list_allows_admin(self):
        status, _, body = request("GET", self.port, "/api/admin/users", token="admintok")
        self.assertEqual(status, 200)
        self.assertTrue(self.j(body)["ok"])

    def test_admin_create_validates_email(self):
        status, _, body = request("POST", self.port, "/api/admin/users", token="admintok",
                                   body={"email": "not-an-email", "password": "longenough1"})
        self.assertEqual(status, 400)

    def test_admin_create_enforces_password_length(self):
        status, _, body = request("POST", self.port, "/api/admin/users", token="admintok",
                                   body={"email": "ok@x.com", "password": "short"})
        self.assertEqual(status, 400)

    def test_admin_create_succeeds_with_valid_input(self):
        status, _, body = request("POST", self.port, "/api/admin/users", token="admintok",
                                   body={"email": "new@x.com", "password": "longenough1"})
        self.assertEqual(status, 200)
        self.assertTrue(self.j(body)["ok"])

    def test_admin_cannot_delete_self(self):
        status, _, body = request("DELETE", self.port, f"/api/admin/users/{ADMIN_UID}", token="admintok")
        self.assertEqual(status, 400)
        self.assertIn("own", self.j(body)["error"].lower())

    def test_admin_delete_rejects_non_uuid(self):
        status, _, body = request("DELETE", self.port, "/api/admin/users/not-a-uuid", token="admintok")
        self.assertEqual(status, 400)

    def test_admin_delete_other_succeeds(self):
        status, _, body = request("DELETE", self.port, f"/api/admin/users/{OTHER_UID}", token="admintok")
        self.assertEqual(status, 200)

    def test_admin_reset_rejects_non_admin(self):
        status, _, body = request("POST", self.port, f"/api/admin/users/{OTHER_UID}/reset",
                                   token="usertok", body={"password": "longenough1"})
        self.assertEqual(status, 403)

    # ---- path traversal containment -------------------------------------
    def test_path_traversal_blocked(self):
        for evil in ("/../service.py", "/css/../../service.py", "/../../etc/passwd", "/..%2fservice.py"):
            status, _, _ = request("GET", self.port, evil)
            self.assertIn(status, (404,), f"{evil} should 404, got {status}")

    def test_static_index_served_with_security_headers(self):
        status, headers, _ = request("GET", self.port, "/")
        self.assertEqual(status, 200)
        self.assertIn("Content-Security-Policy", headers)
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")

    # ---- CORS is not a wildcard -----------------------------------------
    def test_no_wildcard_cors(self):
        status, headers, _ = request("OPTIONS", self.port, "/api/parse",
                                     headers={"Origin": "https://evil.example"})
        self.assertNotEqual(headers.get("Access-Control-Allow-Origin"), "*")
        # Unknown origin is not reflected back.
        self.assertIsNone(headers.get("Access-Control-Allow-Origin"))


if __name__ == "__main__":
    unittest.main()
