"""
USER-DATA-ISOLATION acceptance test (run against the LIVE Supabase project).

Proves, end to end with the public anon key (exactly what a malicious agent
would use), that Row-Level Security holds AND that the privilege-escalation fix
is in place:

  * Agent B cannot SELECT Agent A's CMA by id, nor see it in a list.
  * Agent B cannot UPDATE or DELETE Agent A's CMA.
  * Agent B cannot INSERT a CMA owned by Agent A.
  * Agent B cannot promote themselves to is_admin (the critical fix).

This is the acceptance test for supabase/harden_security.sql — run it AFTER
applying that migration.

It is NOT auto-discovered by `unittest discover` (no test_ prefix) because it
needs real credentials. Provide two existing accounts via env and run directly:

  PowerShell:
    $env:RLS_A_EMAIL='agentA@example.com'; $env:RLS_A_PASSWORD='...'
    $env:RLS_B_EMAIL='agentB@example.com'; $env:RLS_B_PASSWORD='...'
    python tests/rls_isolation.py

Exits 0 on all-pass (or SKIP when creds are absent), non-zero on any failure.
"""
import json
import os
import sys
import uuid
import urllib.error
import urllib.request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://bzppmddqkajswjjrxbem.supabase.co").rstrip("/")
ANON_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_yy9y6niM0KuGUS3PJ2IDbQ_dNCGqBuj")

A_EMAIL, A_PW = os.environ.get("RLS_A_EMAIL"), os.environ.get("RLS_A_PASSWORD")
B_EMAIL, B_PW = os.environ.get("RLS_B_EMAIL"), os.environ.get("RLS_B_PASSWORD")

_failures = []


def check(name, ok, detail=""):
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{' — ' + detail if detail else ''}")
    if not ok:
        _failures.append(name)


def api(method, path, token=None, body=None, prefer=None):
    url = SUPABASE_URL + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", ANON_KEY)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw.decode("utf-8", "replace")}


def sign_in(email, pw):
    status, data = api("POST", "/auth/v1/token?grant_type=password",
                       body={"email": email, "password": pw})
    if status != 200 or not isinstance(data, dict) or not data.get("access_token"):
        print(f"Could not sign in {email}: {status} {data}")
        sys.exit(3)
    return data["access_token"], data["user"]["id"]


def main():
    if not all([A_EMAIL, A_PW, B_EMAIL, B_PW]):
        print("SKIP: set RLS_A_EMAIL/PASSWORD and RLS_B_EMAIL/PASSWORD to run the isolation test.")
        return 0

    a_token, a_uid = sign_in(A_EMAIL, A_PW)
    b_token, b_uid = sign_in(B_EMAIL, B_PW)
    check("two distinct agents", a_uid != b_uid, f"A={a_uid} B={b_uid}")

    cma_id = str(uuid.uuid4())
    status, _ = api("POST", "/rest/v1/cmas", token=a_token,
                    body={"id": cma_id, "user_id": a_uid, "title": "rls-isolation-test", "data": {}},
                    prefer="return=representation")
    check("Agent A can create their own CMA", status in (200, 201), f"status {status}")

    try:
        # B cannot read A's CMA by id
        status, rows = api("GET", f"/rest/v1/cmas?id=eq.{cma_id}&select=id,title", token=b_token)
        check("Agent B cannot read Agent A's CMA by id", status == 200 and rows == [], f"status {status} rows {rows}")

        # B cannot see A's CMA in a full list
        status, rows = api("GET", "/rest/v1/cmas?select=id", token=b_token)
        ids = [r.get("id") for r in (rows or [])]
        check("Agent A's CMA absent from Agent B's list", cma_id not in ids)

        # B cannot UPDATE A's CMA
        status, rows = api("PATCH", f"/rest/v1/cmas?id=eq.{cma_id}", token=b_token,
                           body={"title": "hacked"}, prefer="return=representation")
        check("Agent B cannot update Agent A's CMA", status in (200, 204) and not rows, f"status {status} rows {rows}")

        # Confirm via A that the title is unchanged
        status, rows = api("GET", f"/rest/v1/cmas?id=eq.{cma_id}&select=title", token=a_token)
        title = rows[0]["title"] if rows else None
        check("Agent A's CMA title intact after B's attempt", title == "rls-isolation-test", f"title={title}")

        # B cannot DELETE A's CMA
        api("DELETE", f"/rest/v1/cmas?id=eq.{cma_id}", token=b_token)
        status, rows = api("GET", f"/rest/v1/cmas?id=eq.{cma_id}&select=id", token=a_token)
        check("Agent B cannot delete Agent A's CMA", bool(rows), "row still present for A")

        # B cannot INSERT a CMA owned by A (mass-assignment / ownership spoof)
        status, _ = api("POST", "/rest/v1/cmas", token=b_token,
                        body={"id": str(uuid.uuid4()), "user_id": a_uid, "title": "spoof", "data": {}})
        check("Agent B cannot create a CMA owned by Agent A", status not in (200, 201), f"status {status}")

        # THE CRITICAL ONE: B cannot self-promote to is_admin
        api("PATCH", f"/rest/v1/profiles?id=eq.{b_uid}", token=b_token, body={"is_admin": True})
        status, rows = api("GET", f"/rest/v1/profiles?id=eq.{b_uid}&select=is_admin", token=b_token)
        still_admin = bool(rows and rows[0].get("is_admin"))
        check("Agent B cannot self-promote to is_admin", not still_admin, f"is_admin={still_admin}")
    finally:
        # Cleanup: A removes the test CMA.
        api("DELETE", f"/rest/v1/cmas?id=eq.{cma_id}", token=a_token)

    print()
    if _failures:
        print(f"{len(_failures)} CHECK(S) FAILED: {', '.join(_failures)}")
        return 1
    print("All isolation checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
