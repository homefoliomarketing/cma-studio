// The CMA data model, editable defaults, and saving/loading.

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
    id: uid('cma'),
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
const DRAFT_KEY = 'cma:draft';

export function saveDraft(cma) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cma)); } catch {}
}
export function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

// Upload a PDF: stores the full file, reads page 1, extracts photos, renders
// every page. Returns { data, photos, pages, uploadId, pageCount }.
export async function uploadPdf(file) {
  const res = await fetch('/api/upload', { method: 'POST', body: file });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not read this PDF.');
  return json;
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

export async function saveCmaToServer(cma) {
  cma.savedAt = new Date().toISOString();
  cma.id = cma.id || ('cma_' + Date.now());
  const res = await fetch('/api/cma', { method: 'POST', body: JSON.stringify(cma) });
  return res.json();
}
export async function listCmas() {
  const res = await fetch('/api/cma');
  return (await res.json()).items || [];
}
export async function openCma(id) {
  const res = await fetch('/api/cma/' + encodeURIComponent(id));
  const json = await res.json();
  if (!json.ok) throw new Error('Could not open that CMA.');
  return json.data;
}
export async function deleteCma(id) {
  await fetch('/api/cma/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function loadSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('cma:settings') || 'null'); } catch {}
  if (!s) {
    try {
      const res = await fetch('/api/settings');
      s = (await res.json()).data;
    } catch {}
  }
  return mergeSettings(defaultSettings(), s);
}
export async function persistSettings(settings) {
  try { localStorage.setItem('cma:settings', JSON.stringify(settings)); } catch {}
  try { await fetch('/api/settings', { method: 'POST', body: JSON.stringify(settings) }); } catch {}
}

function mergeSettings(base, override) {
  if (!override) return base;
  // The preset structure is versioned. If a saved copy predates the current
  // structure, reset presets to the new defaults (keeping the realtor's branding).
  const op = override.presets || {};
  const presets = (override.version === base.version)
    ? { ...base.presets, ...op, heating: { ...base.presets.heating, ...(op.heating || {}) } }
    : base.presets;
  return {
    version: base.version,
    presets,
    branding: { ...base.branding, ...(override.branding || {}) },
  };
}
