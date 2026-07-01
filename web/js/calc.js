// The CMA math. Pure functions — no DOM.
//
// Adjustment convention: a POSITIVE amount is ADDED to the comp's sale price,
// a NEGATIVE amount is SUBTRACTED. We adjust the comp TOWARD the subject:
//   comp inferior to subject  -> add    (+)   "the subject is worth more"
//   comp superior to subject  -> subtract (−)
// so amount = (subject − comp) × per-unit dollars.

import { ITEM_DEFS, INTERIOR_CONDITION_LEVELS, EXTERIOR_CONDITION_LEVELS } from './state.js';

const num = (x) => (x == null || x === '' || isNaN(x)) ? 0 : Number(x);
// Index of a condition within its own scale. Tolerant of values saved under the
// old 5-level scale (Dated/Updated/Good/Excellent/New) so reopening an older CMA
// still adjusts sensibly; unknown/blank falls to the middle ('Good'), the default.
const CONDITION_LEGACY = { 'Dated': 0, 'Original': 0, 'Needs Work': 0, 'Original/Dated': 0, 'Updated': 1, 'Good': 1, 'Excellent': 2, 'New': 2 };
function condIdx(lvl, levels) {
  const i = levels.indexOf(lvl);
  if (i !== -1) return i;
  const j = CONDITION_LEGACY[lvl];
  return j == null ? Math.floor((levels.length - 1) / 2) : Math.min(j, levels.length - 1);
}

// True if the property has any AC. Reads the new `ac` enum, falling back to the
// legacy boolean `centralAir` for CMAs saved before AC became a 3-way choice.
function hasAC(p) {
  if (p.ac != null && p.ac !== '') return p.ac === 'Central' || p.ac === 'Ductless Split';
  return !!p.centralAir;
}

// Garage spaces implied by a garageType label (for the adjustment math).
const GARAGE_SPACES = { 'None': 0, 'Single': 1, '1.5 Car': 1.5, 'Double': 2, 'Triple': 3 };
// Resolve a property's garage to {has, spaces}, preferring the new `garageType`
// label and falling back to the legacy hasGarage/garageSpaces fields.
function garageInfo(p) {
  if (p.garageType != null && p.garageType !== '') {
    if (p.garageType === 'None') return { has: false, spaces: 0 };
    const sp = GARAGE_SPACES[p.garageType] ?? 1; // 'Other' / free text → 1
    return { has: true, spaces: sp };
  }
  if (p.hasGarage) return { has: true, spaces: Math.max(1, Number(p.garageSpaces) || 1) };
  return { has: false, spaces: 0 };
}

// Dollar "worth" of a property's garage: none = 0; otherwise a base value for
// having one at all (noGarage) plus an extra amount per space beyond the first.
function garageValue(p, presets) {
  const g = garageInfo(p);
  if (!g.has) return 0;
  return presets.noGarage + (g.spaces - 1) * presets.garageSpace;
}

// Is there a finished (or partly finished) basement?
function isFinished(p) {
  const b = (p.basement || '').toLowerCase();
  if (!b || /none/.test(b)) return false;            // no basement at all
  const f = (p.basementFinish || '').toLowerCase();
  return /fully|finished|partial/.test(f) && !/unfinish/.test(f);
}

// Suggested adjustment for one item, comparing subject vs comp.
export function suggestAdjustment(item, subject, comp, presets) {
  const p = presets;
  switch (item.key) {
    case 'beds': {
      const s = bedsSplit(subject), c = bedsSplit(comp);
      return (s.ag - c.ag) * p.bedroomAbove + (s.bg - c.bg) * p.bedroomBelow;
    }
    case 'baths': {
      const s = bathsSplit(subject), c = bathsSplit(comp);
      return (s.full - c.full) * p.fullBath + (s.half - c.half) * p.halfBath;
    }
    case 'air':   return ((hasAC(subject) ? 1 : 0) - (hasAC(comp) ? 1 : 0)) * p.centralAir;
    case 'garage': return garageValue(subject, p) - garageValue(comp, p);
    case 'heating': return heatingValue(subject, p) - heatingValue(comp, p);
    case 'basement': {
      const s = isFinished(subject), c = isFinished(comp);
      return s && !c ? p.finishedBasement : (!s && c ? -p.finishedBasement : 0);
    }
    case 'intCond': return (condIdx(subject.interiorCondition, INTERIOR_CONDITION_LEVELS) - condIdx(comp.interiorCondition, INTERIOR_CONDITION_LEVELS)) * p.conditionPerLevel;
    case 'extCond': return (condIdx(subject.exteriorCondition, EXTERIOR_CONDITION_LEVELS) - condIdx(comp.exteriorCondition, EXTERIOR_CONDITION_LEVELS)) * p.conditionPerLevel;
    default: return 0; // sqft, lot, style → manual (realtor types the $)
  }
}

// Bedrooms split above/below grade ($7k vs $4k). Total-only data → above grade.
function bedsSplit(p) {
  let ag = num(p.bedsAg), bg = num(p.bedsBg);
  if (!ag && !bg && num(p.bedsTotal)) ag = num(p.bedsTotal);
  return { ag, bg };
}
// Bathrooms split full/half. Total-only data → counted as full baths.
function bathsSplit(p) {
  let full = num(p.bathsFull), half = num(p.bathsHalf);
  if (!full && !half && num(p.bathsTotal)) full = num(p.bathsTotal);
  return { full, half };
}
// Relative dollar "worth" of a property's heating system (0 if unknown/Other).
function heatingValue(p, presets) {
  return num((presets.heating || {})[p.heating]);
}

// Stored override (if the realtor typed/locked a value), else the suggestion.
export function effectiveAdjustment(cma, comp, item, settings) {
  const ov = cma.adjustments?.[comp.id]?.[item.key];
  if (ov && ov.locked) return num(ov.v);
  return suggestAdjustment(item, cma.subject, comp, settings.presets);
}

export function isLocked(cma, comp, item) {
  return !!cma.adjustments?.[comp.id]?.[item.key]?.locked;
}

export function setOverride(cma, comp, item, value) {
  if (!cma.adjustments[comp.id]) cma.adjustments[comp.id] = {};
  cma.adjustments[comp.id][item.key] = { v: num(value), locked: true };
}

export function clearOverride(cma, comp, item) {
  if (cma.adjustments[comp.id]) delete cma.adjustments[comp.id][item.key];
}

// Sum of all adjustments for one comp (enabled items + custom rows).
export function compTotal(cma, comp, settings) {
  let t = 0;
  for (const key of cma.enabledItems) {
    const item = ITEM_DEFS.find(d => d.key === key);
    if (!item || item.type === 'info') continue;
    t += effectiveAdjustment(cma, comp, item, settings);
  }
  for (const row of cma.customRows) t += num(row.amounts?.[comp.id]);
  return t;
}

export function adjustedPrice(comp, total) {
  return num(comp.salePrice) + total;
}

// "None" / "Double" / "2 car" — shared by the grid and the report. Prefers the
// new garageType label, falling back to the legacy hasGarage/garageSpaces.
export function garageDisplay(p) {
  if (p.garageType != null && p.garageType !== '') return p.garageType;
  if (!p.hasGarage) return 'None';
  const n = num(p.garageSpaces);
  return n >= 1 ? `${n} car` : 'Yes';
}

// "None" / "Full Basement · Fully" — shared by the grid and the report.
export function basementDisplay(p) {
  if (!p.basement || /none/i.test(p.basement)) return p.basement || '—';
  return p.basementFinish ? `${p.basement} · ${p.basementFinish}` : p.basement;
}

// Human-readable value of one comparison item for a property.
export function itemDisplay(item, p) {
  switch (item.key) {
    case 'sqft': return p.sqftRaw || (p.sqftMid ? Number(p.sqftMid).toLocaleString() : '—');
    case 'lot': return p.lot || '—';
    case 'style': return p.style || '—';
    case 'beds': return (p.bedsBg > 0) ? `${p.bedsAg || 0}+${p.bedsBg}` : (p.bedsTotal ?? '—');
    case 'baths': return p.bathsHalf > 0 ? `${p.bathsFull || 0}+${p.bathsHalf}` : (p.bathsTotal ?? p.bathsFull ?? '—');
    case 'heating': return p.heating || '—';
    case 'garage': return garageDisplay(p);
    case 'basement': return basementDisplay(p);
    case 'air': return (p.ac && p.ac !== '') ? p.ac : (p.centralAir ? 'Central' : 'No');
    case 'intCond': return p.interiorCondition || '—';
    case 'extCond': return p.exteriorCondition || '—';
    default: return '—';
  }
}

// The headline estimate across all comps.
export function estimate(cma, settings) {
  const rows = cma.comps.map(c => {
    const total = compTotal(cma, c, settings);
    return { comp: c, total, adjusted: adjustedPrice(c, total) };
  });
  const vals = rows.filter(r => num(r.comp.salePrice) > 0).map(r => r.adjusted);
  const average = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  return {
    rows,
    count: vals.length,
    average,
    low: vals.length ? Math.min(...vals) : 0,
    high: vals.length ? Math.max(...vals) : 0,
  };
}
