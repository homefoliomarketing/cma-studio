# CLOUD CMA BUILD — SESSION HANDOFF (complete the cloud web-app migration)

## 0. How to work this session (READ FIRST)
- **Finish the entire remaining build in one session. Do NOT stop for questions or check-ins.** Every decision is pre-made in §2. If you hit an undocumented fork, pick the sensible default, note it in one line, and keep going.
- **The user (Bud Jones) is non-technical** ("vibe coding"). Never ask him to run commands or edit files. The ONLY things he must do himself are the host-account creation + secret-key paste in §7 — do NOT stop mid-build for these; build and verify everything else first, then present §7 as one short checklist at the very end.
- **Use subagents aggressively to preserve context** (§6). Delegate every new self-contained file, ALL verification (screenshots/end-to-end), and all "exact click-path / exact deploy-steps" research. Keep browser-driving + integration + shared-file edits in the orchestrator (you).
- **Verify everything with real evidence.** `mcp__Claude_Preview__preview_screenshot` HANGS — use the headless-Chrome method in §3. Never claim something works unless a subagent saw it render / pass.
- **Honesty rules (global CLAUDE.md) apply:** never present a guess as fact; verify with tools; flag uncertainty; don't claim a test passed you didn't run.
- Memory: read `…/memory/cloud-cma-build.md` and `cma-software-overview.md` first. Update them as you finish phases.

## 1. Mission & current state
**Mission:** turn the finished *local* CMA tool into a **cloud, multi-user web app** for the realtors in Bud's Century 21 office. Web app (browser, log in from any computer) — NOT desktop. Keep the local app working untouched until cutover.

**Already done:**
- The local app is feature-complete (5-step CMA workflow, Settings, Saved CMAs, branded PDF report). See `HANDOFF.md` for its architecture.
- **Supabase project created** (account `budjonez12@gmail.com`, org "CMA"): ref **`bzppmddqkajswjjrxbem`**, URL **`https://bzppmddqkajswjjrxbem.supabase.co`**, region us-west-2, free tier, Healthy.
- **Database schema written** at `supabase/schema.sql` (profiles, cmas, org_settings, RLS, triggers) — NOT yet run.
- **Chrome browser automation works** (see §3 for the reconnect gotcha).

**Remaining:** run the schema + storage + auth on Supabase; rewrite the frontend to use Supabase (login + data + storage + branding split); turn the Python backend into a stateless PDF-parser service that also serves the static app; verify end-to-end against live Supabase; prep deploy. (§5)

## 2. Decisions & defaults — these are LOCKED. Do not re-ask the user.
- **Accounts:** email + password, **invite-only** (public sign-up DISABLED). Admin (Bud) creates agent accounts in the Supabase dashboard. No magic-link/SSO in v1.
- **Isolation:** each agent sees only their own CMAs (enforced by RLS). **No broker/admin oversight view in v1** (a reserved `is_admin` flag exists for later).
- **Branding split:** company brand (C21 colors, logo, company name, tagline) + adjustment presets are **shared office-wide** in `org_settings`. **Per-agent** (name, title, phone, email, headshot) lives in `profiles`. Bud has already filled his branding in the local app — he'll re-enter it once in the new app's Settings (don't build a migration for it).
- **Architecture:** frontend talks to **Supabase directly** (supabase-js) for auth + DB + storage, protected by RLS. The **Python service is stateless**: it only parses MLS PDFs (PDF in → parsed JSON + photo/page images out). It needs **no Supabase keys**. The frontend uploads the returned images to Supabase Storage under the user's session.
- **One deploy:** the Python service ALSO serves the static `web/` frontend (like `server.py` does today). So there's a single host and a single account to create.
- **Supabase config in frontend:** hardcode the Project URL + **publishable** key in `web/js/supa.js`. The publishable key is public-safe (RLS protects data). **The `service_role`/secret key is NOT needed for v1** — keep it out of the repo, chat, and frontend entirely.
- **Drafts:** keep the in-progress draft in `localStorage` (per device); an explicit **Save** writes the CMA to Supabase (`cmas`). Saved CMAs sync across computers; the unsaved draft does not (acceptable).
- **Photo storage:** private buckets; display via short-lived **signed URLs** generated on load. (If signed URLs prove fiddly in the report's print path, fall back to a public `media` bucket with unguessable paths — note the choice.)
- **Old saved CMAs:** migrating Bud's existing local `data/cmas/*.json` is **optional / out of scope for v1** (he has very few; he can re-create them). Do NOT block completion on migration, and do NOT touch the secret key to do it.
- **Host:** deploy the service to **Render** (free tier, Docker) — simplest. Free tier cold-starts (~30s after idle); acceptable for office use — just note it.
- If a step is genuinely gated on a human action (host account, billing, secret paste), **do not stop** — finish and verify everything else, and add the action to the §7 checklist.

## 3. Environment, tooling & access
**Working dir:** `C:\Users\randi\OneDrive\Desktop\Claude Folder\CMA software` (Windows; PowerShell + Bash tools; not a git repo). Python with PyMuPDF (`fitz`) is installed; `pdftoppm` is NOT (render PDFs with `fitz`).

**Chrome automation (browser tools are deferred — load via `ToolSearch` query `"Claude_in_Chrome browser navigate tabs read_page"`):**
- Reconnect procedure: `list_connected_browsers`. If `[]`, the **"Claude for Chrome" extension must be signed into the SAME Claude account as this session = `homefoliomarketing@gmail.com`** (NOT the `budjonez12` Google/Supabase account). That account-match was THE fix last session. Once it shows a browser, `select_browser({deviceId})` then `tabs_context_mcp({createIfEmpty:true})`. (Last deviceId was `8113a888-8119-4cfe-a043-14925c6c6aa5` — may change.)
- Use `browser_batch` for multi-step click/type/screenshot sequences. To inject long SQL/text reliably into Monaco editors (Supabase SQL editor), prefer loading `mcp__Claude_in_Chrome__javascript_tool` and setting the editor value via JS rather than typing (Monaco auto-closes brackets/quotes and corrupts typed SQL).
- Supabase is logged in as `budjonez12@gmail.com`. Dashboard root: `https://supabase.com/dashboard/project/bzppmddqkajswjjrxbem`. Full publishable key: read it from Settings → API Keys (it begins `sb_publishable_yy9y6niM0KuGUS3PJ2IDbQ_dNCGq…`; copy the COMPLETE value — don't trust this prefix).

**Run/verify the LOCAL app (for dev + verification):** `preview_start({name:"cma"})` → serves on `http://127.0.0.1:8770/`. After editing `server.py`/`cma/*`, `preview_stop` then `preview_start`. `preview_eval({serverId, expression})` runs JS in the page (great for asserting state). For screenshots use headless Chrome (preview_screenshot hangs):
```
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu --no-sandbox \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=1340,1800 \
  --virtual-time-budget=7000 --screenshot="C:/…/_ref/shot.png" "http://127.0.0.1:8770/"
```
Render report PDFs with `fitz` and Read the PNGs.

**File map (local app):** `server.py` (static + API + PDF endpoints); `cma/parser.py` (Paragon MLS parser), `cma/media.py` (photo extract + page render); `web/index.html`; `web/css/styles.css`; `web/js/{app.js (controller/routing/auth-to-be), state.js (model + persistence — REWRITE for Supabase), ui.js, forms.js, calc.js, steps/{subject,comps,adjustments,result,report,settings}.js}`; `data/` (local CMAs/uploads/settings — source for the local app only). `supabase/schema.sql` (new).

## 4. Target architecture
- **Auth/data/storage:** Supabase (`profiles`, `cmas`, `org_settings`, Storage buckets), accessed from the browser via `supabase-js` (ESM from `https://esm.sh/@supabase/supabase-js@2`), RLS-enforced.
- **Parser service (Python):** one small web service that (a) serves the static `web/` files, (b) exposes `POST /api/parse` (multipart PDF → `{data, photos:[base64…], pages:[base64…]}`) using the existing `parser.py`/`media.py`. CORS open to its own origin. Stateless, no Supabase keys.
- **Frontend flow:** login (Supabase) → load `org_settings` (company brand + presets) and own `profiles` row → CMA workflow. Uploading an MLS PDF calls `/api/parse`, then the frontend uploads returned images to Storage (`media/{uid}/{cmaId}/…`) and stores their paths in the CMA `data`. Report renders using signed URLs.

## 5. Build steps
**A. Supabase setup (browser; verify each):**
1. Run `supabase/schema.sql` in the SQL editor (`/sql/new`). Verify the 3 tables + policies exist (Table editor / `select` queries).
2. Seed `org_settings` row id=1: `presets` = the v2 defaults from `web/js/state.js defaultSettings().presets`; `company_branding` = the company subset of the current local `data/settings.json` branding (companyName, tagline, primary, accent, logo). (Read those values; paste via SQL `update`.)
3. Storage: create a private bucket **`media`**. Add RLS so authenticated users CRUD only their own folder:
```
create policy "media_own" on storage.objects for all to authenticated
 using (bucket_id='media' and (storage.foldername(name))[1]=auth.uid()::text)
 with check (bucket_id='media' and (storage.foldername(name))[1]=auth.uid()::text);
```
4. Auth → disable public sign-ups (invite-only). Create Bud's account (Authentication → Users → Add user; use his work email). Then `update public.profiles set is_admin=true, full_name='Bud Jones', title='REALTOR', phone='7055421016', email='…' where id='<his uid>';` (and he can refine in-app).

**B. Frontend (orchestrator integrates; subagents draft modules):**
- `web/js/supa.js` — create + export the supabase client (URL + publishable key).
- `web/js/auth.js` + a login view — gate the app: `App.init` checks `supabase.auth.getSession()`; if none, render login (email+password, password-reset link); on success, boot the app. No sign-up UI (invite-only).
- **Rewrite `web/js/state.js` persistence** to Supabase: `saveCmaToServer`→upsert `cmas`; `listCmas`/`openCma`/`deleteCma`→`cmas` queries (RLS auto-scopes); `loadSettings`/`persistSettings`→ company from `org_settings`, agent from `profiles`. Keep `localStorage` draft.
- **Branding split** in `app.js`/`steps/report.js`/`steps/settings.js`: company brand + presets from `org_settings`; agent identity from `profiles`. Settings page: company section read-only for non-admins; agent section editable by everyone.
- **Photos → Storage:** on PDF parse, upload returned images to `media/{uid}/{cmaId}/…`; store paths in CMA `data`; render with signed URLs. Replace all `/api/media/...` usage.

**C. Parser service (subagent drafts):** add a stateless web app (FastAPI + uvicorn recommended, or keep stdlib) exposing `POST /api/parse` using `parser.py`/`media.py`, returning base64 images; serve `web/` statically. Add `requirements.txt` (pymupdf, fastapi, uvicorn, python-multipart), a `Dockerfile`, and a Render config. Test locally end-to-end.

**D. (Optional) migration** — skip for v1 unless trivial; do NOT use the secret key.

**E. Deploy prep** — everything ready so the only remaining actions are §7.

**F. End-to-end verification (subagents):** run the service locally against LIVE Supabase; via headless Chrome: log in as Bud → fill subject → upload the sample `C:\Users\randi\OneDrive\Desktop\Paragon 5 with photos.pdf` → adjust → Save → reopen → print-to-PDF the branded report (render with fitz). Then prove **isolation**: a second test agent (separate Chrome profile/incognito) cannot see Bud's CMAs. Screenshot proof of each.

## 6. Subagent playbook
- **Single-writer rule** for shared files (`app.js`, `index.html`, `styles.css`, `supa.js`) — only the orchestrator edits these.
- **Delegate (parallel where independent):** one subagent per new standalone file (`auth.js`, the parser service + Dockerfile, the state.js Supabase layer drafted as a returned block you paste); a **research** subagent for exact Supabase Storage-policy + invite-only click-paths and exact Render deploy steps; **verification** subagents that run the local service + headless Chrome and report concise PASS/FAIL + screenshots (keep the big images in their context, not yours).
- Give each subagent this file's relevant section + the concrete facts it needs. Run independent agents in one message.

## 7. The ONLY human-gated steps (present as a short checklist at the very end — do not stop mid-build for them)
1. **Create the host account + deploy:** Bud creates a free **Render** account and deploys the service (you'll have the Dockerfile/repo + click-by-click steps ready). This yields the public URL agents will use.
2. **Secret key:** only if any server-side secret is ever needed (v1 shouldn't) — Bud pastes it into Render's env vars himself; never into chat/repo.
3. **MLS board check:** remind Bud to confirm his board is OK with listing data/photos stored in the cloud before real client data goes in.

## 8. Definition of done
- Schema + storage + invite-only auth live on Supabase; Bud's admin account created; `org_settings` seeded.
- App runs against LIVE Supabase: login works; CMAs save/list/open/delete per-agent; PDF parse → photos in Storage → branded report renders with Bud's per-agent branding + shared company brand; **agent isolation proven** (second account can't see Bud's data).
- Parser service + Dockerfile + Render config ready; local end-to-end verified with screenshots.
- `web/js/supa.js` has the real URL + full publishable key; no secret key anywhere in the repo.
- §7 checklist handed to Bud; memory (`cloud-cma-build.md`) updated; local app still works.
- Known issue to keep in mind: some MLS photo-PAGES render blank via PyMuPDF `get_pixmap` (see memory `report-appendix-broken-photos.md`) — pre-existing, low priority.
