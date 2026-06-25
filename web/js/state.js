// The CMA data model, editable defaults, and saving/loading.
import { supabase, MEDIA_BUCKET } from './supa.js';

export const CONDITION_LEVELS = ['Dated', 'Updated', 'Good', 'Excellent', 'New'];

// ---- Click-to-select option lists (realtor's vocabulary) ------------------
// Each is offered as buttons; an "Other" button lets the realtor type anything.
export const HEATING_OPTIONS  = ['Gas Forced Air', 'Propane Forced Air', 'Electric Baseboard', 'Space Heater'];
export const STYLE_OPTIONS    = ['Bungalow', 'Raised bungalow', '2-storey', '1.5 storey', 'Bi-level', 'Backsplit', 'Sidesplit', 'Townhouse'];
export const BASEMENT_OPTIONS = ['None', 'Full Basement'];
export const BASEMENT_FINISH_OPTIONS = ['Fully', 'Partially', 'Unfinished'];

// ---- Editable adjustment presets -----------------------------------------
// IMPORTANT: these are STARTING SUGGESTIONS, not verified market values.
// The realtor sets them to their own market in Settings, and can override any
// single adjustment while building a CMA. Seeded loosely from the user's own
// sample CMA ($3k/bath, $7k/bed) so the first run feels familiar.
export function defaultSettings() {
  return {
    version: 2,
    presets: {
      bedroomAbove:      7000,  // per above-grade bedroom of difference
      bedroomBelow:      4000,  // per below-grade bedroom
      fullBath:          4000,  // per full bath
      halfBath:          2000,  // per half bath
      noGarage:         10000,  // having a garage (1 car) vs none
      garageSpace:       5000,  // each extra space (so 2-car vs none = 15,000)
      finishedBasement: 15000,  // finished vs unfinished basement
      centralAir:        4000,  // one has central air, the other doesn't
      conditionPerLevel:10000,  // per step on the condition scale
      heating: {                // value of each heating system; only the
        'Gas Forced Air':     15000,  // DIFFERENCE between subject & comp applies.
        'Propane Forced Air': 13000,  // Gas/Propane are estimates — tune in Settings.
        'Electric Baseboard':     0,
        'Space Heater':           0,
      },
    },
    branding: {
      companyName: 'CENTURY 21',
      tagline: 'COMPARATIVE MARKET ANALYSIS',
      agentName: '',
      agentTitle: 'Sales Representative',
      phone: '',
      email: '',
      primary: '#252526',   // C21 black
      accent: '#beaf87',    // Relentless Gold
      logo: null,           // data URL
      headshot: null,       // data URL
    },
  };
}

// ---- Which items can be compared (matches the user's CMA vocabulary) ------
// type: info (display only) | numeric | bool | condition | manual (judgement)
// type: numeric/bool/condition/garage -> auto-suggested; manual -> realtor types
// the dollar amount themselves. EVERY row accepts a manual override on the grid.
export const ITEM_DEFS = [
  { key: 'sqft',      label: 'Square feet',        type: 'manual',  field: 'sqftRaw' },
  { key: 'lot',       label: 'Lot size',           type: 'manual'  },
  { key: 'style',     label: 'Style',              type: 'manual',  field: 'style' },
  { key: 'beds',      label: 'Bedrooms',           type: 'numeric', unit: 'bedroom',  field: 'bedsTotal' },
  { key: 'baths',     label: 'Bathrooms',          type: 'numeric', unit: 'fullBath', field: 'bathsTotal' },
  { key: 'heating',   label: 'Heating type',       type: 'manual',  field: 'heating' },
  { key: 'garage',    label: 'Garage',             type: 'garage',  field: 'garage' },
  { key: 'basement',  label: 'Basement',           type: 'manual',  field: 'basementFinish' },
  { key: 'air',       label: 'Central air',        type: 'bool',    unit: 'centralAir', field: 'centralAir' },
  { key: 'intCond',   label: 'Interior condition', type: 'condition', field: 'interiorCondition' },
  { key: 'extCond',   label: 'Exterior condition', type: 'condition', field: 'exteriorCondition' },
];

// ---- Blank records --------------------------------------------------------
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

export function blankProperty() {
  return {
    address: '', city: '', mls: '',
    listPrice: null, salePrice: null,
    bedsAg: null, bedsBg: null, bedsTotal: null,
    bathsFull: null, bathsHalf: null, bathsTotal: null,
    sqftRaw: '', sqftMid: null,
    lot: '', style: '', heating: '',
    garage: '', hasGarage: false, garageSpaces: 0,
    basement: '', basementFinish: '',
    centralAir: false,
    interiorCondition: 'Good', exteriorCondition: 'Good',
    age: '', taxes: null,
    photo: null,         // chosen hero photo (data URL or /api/media URL)
    photos: [],          // all photos pulled from the PDF (/api/media URLs)
    pages: [],           // every original page rendered (/api/media URLs)
    uploadId: null,
    pageCount: 0,
    rooms: [],
    notes: '',
  };
}

export function blankComp() {
  return { id: uid('comp'), source: 'manual', isSold: false, ...blankProperty() };
}

export function blankActive() {
  return { id: uid('active'), source: 'manual', ...blankProperty() };
}

export function newCMA() {
  return {
    // A real UUID so it doubles as the Storage folder name and the `cmas` PK.
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : uid('cma'),
    title: '',
    savedAt: null,
    asOf: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
    subject: blankProperty(),
    comps: [],
    // active (currently-listed) competition — shown for context only, never
    // included in the adjustment math or the value calculation.
    actives: [],
    // which comparison rows appear in the grid (the realtor can delete any)
    enabledItems: ITEM_DEFS.map(d => d.key),
    // per comp, per item: { amount, auto } where amount>0 adds to the comp
    adjustments: {},     // adjustments[compId][itemKey] = { amount, auto, note }
    customRows: [],      // { id, label, amounts: { [compId]: amount } }
    finalValue: null,    // realtor's opinion (defaults to the average)
    step: 'subject',
  };
}

// Infer the Yes/No + number-of-spaces garage model from a free-text MLS value.
export function inferGarage(str) {
  const s = (str || '').toLowerCase();
  if (!s || /\bnone\b|no garage|^\s*0\b|^\s*no\b/.test(s)) return { hasGarage: false, garageSpaces: 0 };
  let n = 0;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (m) n = Math.round(parseFloat(m[1]));
  else if (/triple|3\s*car/.test(s)) n = 3;
  else if (/double|2\s*car/.test(s)) n = 2;
  else if (/single|1\s*car/.test(s)) n = 1;
  if (!n) n = 1;
  return { hasGarage: true, garageSpaces: n };
}

// ---- Map a parsed MLS PDF (server JSON) onto a property record ------------
export function fromParsed(p) {
  const prop = blankProperty();
  prop.address = p.address || '';
  prop.city = p.city || '';
  prop.mls = p.mls_number || '';
  prop.listPrice = p.list_price ?? null;
  prop.salePrice = p.sold_price ?? null;
  prop.bedsAg = p.beds_above_grade ?? null;
  prop.bedsBg = p.beds_below_grade ?? null;
  prop.bedsTotal = p.beds_total ?? null;
  prop.bathsFull = p.baths_full ?? null;
  prop.bathsHalf = p.baths_half ?? null;
  prop.bathsTotal = p.baths_total ?? null;
  prop.sqftRaw = p.sqft?.raw || '';
  prop.sqftMid = p.sqft?.mid ?? null;
  prop.lot = p.lot_size || '';
  prop.style = p.style || p.sub_type || '';
  prop.heating = [p.heating_type, p.heating_source].filter(Boolean).join(' / ');
  prop.garage = p.garage || '';
  const g = inferGarage(p.garage);
  prop.hasGarage = g.hasGarage;
  prop.garageSpaces = g.garageSpaces;
  prop.basement = p.basement || '';
  prop.basementFinish = p.basement_finish || '';
  prop.centralAir = !!p.central_air;
  prop.age = p.age?.raw || '';
  prop.taxes = p.annual_taxes ?? null;
  prop.rooms = p.rooms || [];
  return prop;
}

// ---- Persistence ----------------------------------------------------------
// Auth + data + photo storage are Supabase; the in-progress draft stays in
// localStorage (per device) so a refresh never loses work. An explicit Save
// writes to the `cmas` table, and RLS scopes every read/write to the agent.
const DRAFT_KEY = 'cma:draft';

export function saveDraft(cma) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cma)); } catch {}
}
export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

// The signed-in agent's id, cached after login (app.js calls setAuthUid).
let _uid = null;
let _isAdmin = false;
let _mustReset = false;
export function setAuthUid(id) { _uid = id; }
export function isAdmin() { return _isAdmin; }
export function mustReset() { return _mustReset; }
async function currentUid() {
  if (_uid) return _uid;
  const { data } = await supabase.auth.getUser();
  _uid = data?.user?.id || null;
  return _uid;
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
const rnd = () => Math.random().toString(36).slice(2, 10);

// Decode a "data:image/...;base64,xxxx" URI into a Blob ready for upload.
function dataUriToBlob(uri) {
  const comma = uri.indexOf(',');
  const mime = uri.slice(5, comma).split(';')[0] || 'image/jpeg';
  const bin = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Upload base64 image URIs to Storage; return their public URLs. Bounded
// concurrency keeps a photo-heavy MLS sheet from opening dozens of sockets.
async function uploadImages(uris, prefix) {
  const out = new Array(uris.length);
  let idx = 0;
  async function worker() {
    while (idx < uris.length) {
      const i = idx++;
      const path = `${prefix}_${i}.jpg`;
      const { error } = await supabase.storage.from(MEDIA_BUCKET)
        .upload(path, dataUriToBlob(uris[i]), { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      out[i] = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
    }
  }
  if (uris.length) await Promise.all(Array.from({ length: Math.min(6, uris.length) }, worker));
  return out;
}

// Read a PDF: the stateless parser service returns parsed data + base64 photos
// and page-renders; we upload those images to this agent's Storage folder and
// return their public URLs. Path: media/{uid}/{cmaId}/{uploadId}/photo_N.jpg
export async function uploadPdf(file, cmaId) {
  const res = await fetch('/api/parse', { method: 'POST', body: file });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not read this PDF.');
  const uid = await currentUid();
  const up = rnd();
  const base = `${uid}/${cmaId}/${up}`;
  const [photos, pages] = await Promise.all([
    uploadImages(json.photos || [], `${base}/photo`),
    uploadImages(json.pages  || [], `${base}/page`),
  ]);
  return { data: json.data, photos, pages, pageCount: json.pageCount || 0, uploadId: up };
}

// Merge an upload result onto a property record (subject or comp).
export function applyUpload(prop, result) {
  Object.assign(prop, fromParsed(result.data));
  prop.uploadId = result.uploadId;
  prop.photos = result.photos || [];
  prop.pages = result.pages || [];
  prop.pageCount = result.pageCount || 0;
  if (!prop.photo && prop.photos.length) prop.photo = prop.photos[0];
  return prop;
}

// ---- Saved CMAs (Supabase `cmas`, RLS-scoped to the agent) ----------------
export async function saveCmaToServer(cma) {
  cma.savedAt = new Date().toISOString();
  if (!isUuid(cma.id)) cma.id = (crypto.randomUUID ? crypto.randomUUID() : 'cma_' + Date.now());
  const user_id = await currentUid();
  const { error } = await supabase.from('cmas').upsert({
    id: cma.id,
    user_id,
    title: cma.title || cma.subject?.address || 'Untitled CMA',
    data: cma,
  });
  if (error) throw new Error(error.message);
  return { ok: true, id: cma.id };
}
export async function listCmas() {
  const { data, error } = await supabase.from('cmas')
    .select('id,title,updated_at').order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({ id: r.id, title: r.title, savedAt: r.updated_at }));
}
export async function openCma(id) {
  const { data, error } = await supabase.from('cmas').select('data').eq('id', id).single();
  if (error || !data) throw new Error('Could not open that CMA.');
  return data.data;
}
export async function deleteCma(id) {
  const { error } = await supabase.from('cmas').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---- Settings: shared company brand + presets (org_settings) merged with the
// agent's own identity (their profiles row), returned as ONE branding object so
// the rest of the app and the report read it exactly as before.
export async function loadSettings() {
  const base = defaultSettings();
  let org = null, profile = null;
  try {
    const uid = await currentUid();
    const [orgRes, profRes, mrRes] = await Promise.all([
      supabase.from('org_settings').select('presets,company_branding').eq('id', 1).single(),
      supabase.from('profiles').select('full_name,title,phone,email,headshot_url,is_admin').eq('id', uid).single(),
      // must_reset is fetched on its own so that, before the column exists, a
      // "column not found" error can't wipe out the agent's loaded identity.
      supabase.from('profiles').select('must_reset').eq('id', uid).single(),
    ]);
    org = orgRes.data; profile = profRes.data;
    _mustReset = !!(mrRes.data && mrRes.data.must_reset);
  } catch {}

  const op = (org && org.presets) || {};
  const presets = Object.keys(op).length
    ? { ...base.presets, ...op, heating: { ...base.presets.heating, ...(op.heating || {}) } }
    : base.presets;

  const cb = (org && org.company_branding) || {};
  _isAdmin = !!(profile && profile.is_admin);
  const branding = {
    ...base.branding,
    // shared company brand (org_settings)
    companyName: cb.companyName || base.branding.companyName,
    tagline:     cb.tagline     || base.branding.tagline,
    primary:     cb.primary     || base.branding.primary,
    accent:      cb.accent      || base.branding.accent,
    logo:        cb.logo        || null,
    // per-agent identity (profiles)
    agentName:  (profile && profile.full_name) || '',
    agentTitle: (profile && profile.title)     || base.branding.agentTitle,
    phone:      (profile && profile.phone)     || '',
    email:      (profile && profile.email)     || '',
    headshot:   (profile && profile.headshot_url) || null,
  };
  return { version: base.version, presets, branding, isAdmin: _isAdmin, mustReset: _mustReset };
}

export async function persistSettings(settings) {
  const b = settings.branding || {};
  const uid = await currentUid();
  // Agent identity -> own profile row (every agent may edit their own).
  try {
    await supabase.from('profiles').update({
      full_name:    b.agentName  || null,
      title:        b.agentTitle || null,
      phone:        b.phone      || null,
      email:        b.email      || null,
      headshot_url: b.headshot   || null,
    }).eq('id', uid);
  } catch {}
  // Company brand + presets -> shared org_settings (admins only; RLS enforces).
  if (settings.isAdmin || _isAdmin) {
    try {
      await supabase.from('org_settings').update({
        presets: settings.presets,
        company_branding: {
          companyName: b.companyName, tagline: b.tagline,
          primary: b.primary, accent: b.accent, logo: b.logo || null,
        },
      }).eq('id', 1);
    } catch {}
  }
}

// Clear the "must reset password" flag once a temp-password agent has chosen
// their own password. RLS lets each agent update their own profile row.
export async function clearMustReset() {
  const uid = await currentUid();
  const { error } = await supabase.from('profiles').update({ must_reset: false }).eq('id', uid);
  if (error) throw new Error(error.message);
  _mustReset = false;
}
