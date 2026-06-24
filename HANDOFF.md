# CMA Software — Build Handoff (for the next session)

> **STATUS (2026-06-24): ✅ COMPLETE.** Task 10 (Settings) and Task 9 (Saved CMAs) are built, wired, and verified. The app is feature-complete: 5-step workflow + Settings + Saved CMAs. Branding (company/agent/logo/colours) now flows live to the sidebar and the report. Verified end-to-end with the real `Paragon 5 with photos.pdf` → branded PDF (cover + grid + appendix). One **pre-existing, out-of-scope** issue remains: the appendix renders broken photos on some MLS photo pages (PyMuPDF `get_pixmap` limitation in `cma/media.py` — a background task was spawned; see memory `report-appendix-broken-photos`). The sections below remain the architecture/run/verify reference.

## 0. How to work this session (READ FIRST)

- **Finish the whole job in one session. Do not stop to ask the user for check-ins.** Everything you need to make decisions is in this file and in your memory (`MEMORY.md`). If you hit a genuine fork, pick the sensible default documented here, note it, and keep going.
- **Only two features remain: Settings (Task 10) and Saved-CMAs list (Task 9), plus a little branding wiring and a final end-to-end QA.** Specs are in §4.
- **Use sub-agents aggressively to preserve context and parallelize** — see §1.
- **Verify everything you build with a real screenshot** (the preview screenshot tool is broken here — use the headless-Chrome method in §3). Don't claim something works unless you saw it render.
- The user is **non-technical** ("vibe coding"). Do all the work yourself; never ask them to run commands or edit files. Keep any prose to them short and plain.
- When done: update `MEMORY.md`, mark Tasks 9 & 10 complete, do a clean end-to-end run that produces a PDF, and give the user a short summary.

## 1. Sub-agent strategy (the user explicitly asked for this)

Goal: keep this session's context small and move fast. The remaining work is small but verification (screenshots, PDF renders) is context-heavy — that's the best thing to delegate.

- **Single-writer rule for shared files.** Only YOU (the orchestrator) edit `web/js/app.js`, `web/css/styles.css`, and `web/index.html`. This avoids merge conflicts.
- **Delegate self-contained modules.** Spawn a `general-purpose` sub-agent to write each NEW, standalone file and return it: e.g. one agent fully implements `web/js/steps/settings.js`, another implements `web/js/steps/saved.js`. Give each agent this file's §4 spec + §6 facts. Have them **return the CSS to add as a text block** rather than editing `styles.css` themselves — you paste it in.
- **Delegate verification (highest-value delegation).** After you wire a feature, spawn a sub-agent whose whole job is: start/refresh the preview, run the headless-Chrome screenshot (§3), inspect it, and report back a concise PASS/FAIL + what it saw. The big image stays in the sub-agent's context, not yours.
- **Delegate the final QA pass.** One sub-agent does the full click-through (§5 acceptance) and reports.
- Run independent agents **in parallel** (multiple Agent calls in one message). Keep wiring/integration sequential and in your own hands.

## 2. What this is (one paragraph)

A local web app that helps a **Century 21 realtor** build a Comparative Market Analysis: enter a subject property, upload 2–4 **sold** MLS PDFs (auto-read, photos extracted), optionally add **active** competing listings (context only), apply +/− dollar **adjustments**, get an averaged **market value**, and export a **branded, printable PDF report** (with the original MLS pages appended). Runs entirely on the user's machine; opens in Chrome via `Start CMA.bat`. No build step, no external calls (fonts bundled).

## 3. How to run & verify (CRITICAL — the tooling here is quirky)

**Run the app (preview server):**
- `preview_start({name:"cma"})` → serves on `http://127.0.0.1:8770/` (config in `.claude/launch.json`, runs `python server.py 8770 --no-open`).
- **After editing `server.py` or anything in `cma/`, you MUST restart it:** `preview_stop` then `preview_start` (static web files are served fresh and need no restart).

**Screenshots — `mcp__Claude_Preview__preview_screenshot` HANGS here. Don't use it.** Use the user's installed Chrome headless via Bash (this Bash runs on the user's real Windows machine, so localhost + Chrome are reachable; PyMuPDF/`fitz` is installed; `pdftoppm` is NOT, so `Read` can't rasterize PDFs — render with `fitz` instead):
```
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu --no-sandbox \
  --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,1400 \
  --virtual-time-budget=6000 --screenshot="C:/abs/path/_ref/shot.png" "http://127.0.0.1:8770/"
```
Then `Read` the PNG. Notes: classic `--headless` works (`--headless=new` gave no file once). `--virtual-time-budget` is required or entrance animations capture at opacity 0. App width needs the window ≥ ~1200 (sidebar 268px + content).

**Verify the actual PDF output** (the user's "Save as PDF" path):
```
chrome --headless --no-pdf-header-footer --virtual-time-budget=8000 \
  --print-to-pdf="C:/abs/_ref/out.pdf" "http://127.0.0.1:8770/?seeddemo"
```
then render pages with `fitz` and Read them.

**Inspect DOM/state without a screenshot:** `preview_eval({serverId, expression})` works fine (run JS in the page, returns JSON). Good for checking counts, computed styles, `naturalWidth>0` on images, etc.

**Seeding a populated screen for screenshots (TEMPORARY — always remove):** the app starts empty, so to screenshot a populated step, temporarily add a demo seed to `web/js/app.js` `init()` guarded by `if (location.search.includes('seeddemo')) this._seedDemo();` plus an `App._seedDemo = function(){...}`. Screenshot `/?seeddemo`, then **delete the seed code**. Real served photos/pages exist under `data/uploads/aae07a91e5e44295/` (`photo_1..28.jpg`, `page_1..6.jpg`) — reference `"/api/media/aae07a91e5e44295/photo_1.jpg"` etc. (Prior seeds were removed; check `app.js` ends cleanly with `window.App = App; App.init();`.)

## 4. Remaining work — detailed specs

### Task 10 — Settings (do this first; it personalizes every report)
File: `web/js/steps/settings.js` (currently a placeholder; replace `renderSettings(root, ctx)`). It already routes via the sidebar "Settings" item and `App.go('settings')`. `ctx.settings` is the live settings object; `ctx.saveSettings()` persists (localStorage + server). Reuse controls from `web/js/forms.js` (`textField`, `numberField`, `moneyField`, `photoField`) and the `.card`/`.section-label`/`.form-grid` styles.

Build two sections:
1. **Branding** (writes to `ctx.settings.branding`): companyName, tagline, agentName, agentTitle, phone, email (textFields); **logo** and **headshot** uploads (use `photoField` → stores data URL); brand **primary** + **accent** color inputs (`<input type=color>`), defaulting to C21 `#252526` / `#beaf87`. A "Reset to Century 21 defaults" button (re-apply values from `defaultSettings().branding`).
2. **Adjustment presets** (writes to `ctx.settings.presets`): a `numberField`/`moneyField` per key — `bedroom, fullBath, halfBath, garageSpace, noGarage, finishedBasement, sqftPer, conditionPerLevel, centralAir`. Label them plainly ("Per bedroom", "Per full bath", "Per sq ft", "Per condition level", etc.). Add a one-line honesty note: "Starting suggestions — set these to your market."

Behavior: on any change, call `ctx.saveSettings()` (persist) and re-apply branding live (see branding wiring below). A "Save" press isn't required since it autosaves, but a confirmation flash is nice. After changes, the **sidebar** (company name/logo) and the **report** should reflect them — the report already reads `branding` and sets `--brand`/`--accent`; the sidebar already reads `companyName`/`logo`, so a `ctx.refresh()` after edits updates it.

**Branding-apply wiring (YOU do this in `app.js`):** add `App.applyBranding = function(){ const b=this.settings.branding; const r=document.documentElement.style; r.setProperty('--brand', b.primary); r.setProperty('--accent', b.accent); }` and call it at the end of `init()` (after settings load) and whenever settings change. This makes custom colors flow app-wide (buttons, focus rings, accents). The sidebar gradient uses literal dark hexes; that's fine to leave (C21 is black). Optional polish: derive `.sidebar` background from `--brand`.

### Task 9 — Saved CMAs list
The back end is done: `state.js` exports `saveCmaToServer`, `listCmas`, `openCma`, `deleteCma`; server routes `/api/cma` (GET list, POST save), `/api/cma/:id` (GET, DELETE) exist and work. `App.saveNow()` already saves the current CMA. What's missing is the browse/open UI.

- New file `web/js/steps/saved.js` exporting `renderSaved(root, ctx)`: `await listCmas()` → render cards/rows (title, savedAt). Each row: **Open** (`const data = await openCma(id); App.cma = data; store.saveDraft(data); App.go('subject')` — or 'report'), and **Delete** (`await deleteCma(id)` then re-render, with confirm). Empty state: "No saved CMAs yet."
- Wire in `app.js`: add a sidebar item "Saved CMAs" next to "New CMA" calling `this.go('saved')`; in `main()` route `'saved'` to `renderSaved` (it's not in `STEPS`; handle like `'settings'` — note `main()` currently falls back to `renderSettings` for non-step keys, so add an explicit `saved`→`renderSaved` branch). Import `renderSaved` at top.
- `renderSaved` is async; either make the render await-friendly (render a "Loading…" then replace) or fetch then build.

## 5. Definition of done (acceptance — verify each with a screenshot/eval)

1. **Settings**: editing a preset (e.g., per-bedroom) changes the auto-adjustment on the grid; editing company/agent updates the sidebar and the report cover; uploading a logo shows it in the sidebar + report band; color change re-themes the app. Persists across reload (localStorage + `data/settings.json`).
2. **Saved CMAs**: Save the current CMA → it appears in the Saved list → Open restores it fully → Delete removes it.
3. **Full end-to-end run (no seed):** upload the real sample `C:\Users\randi\OneDrive\Desktop\Paragon 5 with photos.pdf` as a comp, fill a subject, adjust, and **print-to-PDF** a clean multi-page branded report. Render it with `fitz` and eyeball the cover + grid + an appendix page.
4. No leftover `_seedDemo`/`?seeddemo` code in `app.js`. Tasks 9 & 10 marked complete. `MEMORY.md` updated.

## 6. Architecture, file map & key facts

**Stack:** Python stdlib `http.server` + PyMuPDF (`fitz`) back end (no extra installs — both present). Vanilla ES-module front end, no build step. Launch via `Start CMA.bat` (finds Python, ensures `pymupdf`, runs `server.py`, opens Chrome on `127.0.0.1`).

**Files:**
- `server.py` — routes: `GET` static + `/api/cma` (list) + `/api/cma/:id` + `/api/settings` + `/api/media/:id/:file`; `POST /api/upload` (store PDF, parse, extract photos, render pages), `/api/parse`, `/api/cma`, `/api/settings`; `DELETE /api/cma/:id`. Binds 127.0.0.1, auto-finds port, opens Chrome (skip with `--no-open`).
- `cma/parser.py` — `parse_doc(doc)` / `parse_bytes` / `parse_pdf`. Coordinate-based label→value extraction tuned to the **Paragon** one-page MLS sheet. SqFt & Age come as **ranges** (`{raw,low,high,mid}`).
- `cma/media.py` — `extract_photos` (embedded images ≥200×160 → JPEG) + `render_pages` (each page → JPEG).
- `web/index.html` — loads `css/fonts.css`, `css/styles.css`, `js/app.js` (module). `#app.app` is the grid root.
- `web/css/styles.css` — full design system + per-step sections + **`@media print`** block. `web/css/fonts.css` + `web/fonts/*.woff2` — bundled Barlow.
- `web/js/`: `app.js` (controller, sidebar, routing, autosave, save-to-server), `state.js` (model, `defaultSettings`, `ITEM_DEFS`, `CONDITION_LEVELS`, persistence, `uploadPdf`/`applyUpload`), `ui.js` (`el`, `money`, `signedMoney`, `parseMoney`, `flash`), `forms.js` (field controls + `dropzone`), `calc.js` (adjustment math + `itemDisplay` + `estimate`), `steps/{subject,comps,adjustments,result,report,settings}.js`, `steps/_placeholder.js`.
- Data: `data/cmas/*.json` (saved CMAs), `data/uploads/<id>/` (original.pdf + photos + page renders), `data/settings.json`.
- `_ref/` — scratch screenshots/test artifacts (safe to ignore or delete; not part of the app).

**Brand (Century 21 — do NOT use C21's red `#af2f2c` or teal/blue `#00aac3`):** black `#252526`, Relentless Gold `#beaf87`, dark gold `#a19276`/legible `#8a7a4d`, warm Site White `#f4f1ea`, greys `#808285`/`#e6e7e8`. Headline font **Barlow Semi Condensed**, body **Barlow** (both bundled). +/− adjustment indicators use green `#3f7a52` / clay `#a4572f` (functional, NOT the brand red — user was told and is fine to change).

**Adjustment model (verified against the user's own CMA):** rows = comparison items (`ITEM_DEFS`) the realtor can DELETE, plus custom rows. Convention in `calc.js`: amount **positive = add to comp, negative = subtract**; comp inferior to subject → `+`, superior → `−`; `amount = (subject − comp) × per-unit`. Per-comp total = Σ enabled-item adjustments + custom rows. **Adjusted price = sale price + total. Estimated value = average of adjusted prices** (user can override via `cma.finalValue`; Result step has rounding helpers). Overrides stored at `cma.adjustments[compId][itemKey] = {v, locked}`; unlocked cells show the live suggestion. Condition scale `['Dated','Updated','Good','Excellent','New']`.

**Other facts:** MLS miscounts baths when there's an ensuite (shows 1 full when really 2) → all parsed fields stay editable. `cma.actives` = active competition, **display-only, never in the math**. Photos: hero = `prop.photo`; `prop.photos[]` = gallery; `prop.pages[]` = original pages (report appendix). Report writes `--brand`/`--accent` from branding and is print-isolated via `@media print` (`-webkit-print-color-adjust:exact`). localStorage keys: `cma:draft`, `cma:settings`.

## 7. Cleanup (optional, end of session)
- Ensure no `_seedDemo`/`?seeddemo` remnants in `app.js`.
- `_ref/` and `data/uploads/<test ids>` hold test artifacts — fine to leave or clear.
- Stray local servers from prior sessions may linger on ports 8765/8770; just `preview_start({name:"cma"})` (reuses or starts a clean one).
