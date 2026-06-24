// The CMA math. Pure functions — no DOM.
//
// Adjustment convention: a POSITIVE amount is ADDED to the comp's sale price,
// a NEGATIVE amount is SUBTRACTED. We adjust the comp TOWARD the subject:
//   comp inferior to subject  -> add    (+)   "the subject is worth more"
//   comp superior to subject  -> subtract (−)
// so amount = (subject − comp) × per-unit dollars.

import { ITEM_DEFS, CONDITION_LEVELS } from './state.js';

const num = (x) => (x == null || x === '' || isNaN(x)) ? 0 : Number(x);
const condIdx = (lvl) => Math.max(0, CONDITION_LEVELS.indexOf(lvl));

// Dollar "worth" of a property's garage: none = 0; otherwise a base value for
// having one at all (noGarage) plus an extra amount per space beyond the first.
function garageValue(p, presets) {
  if (!p.hasGarage) return 0;
  const spaces = Math.max(1, num(p.garageSpaces) || 1);
  return presets.noGarage + (spaces - 1) * presets.garageSpace;
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
    case 'air':   return ((subject.centralAir ? 1 : 0) - (comp.centralAir ? 1 : 0)) * p.centralAir;
    case 'garage': return garageValue(subject, p) - garageValue(comp, p);
    case 'heating': return heatingValue(subject, p) - heatingValue(comp, p);
    case 'basement': {
      const s = isFinished(subject), c = isFinished(comp);
      return s && !c ? p.finishedBasement : (!s && c ? -p.finishedBasement : 0);
    }
    case 'intCond': return (condIdx(subject.interiorCondition) - condIdx(comp.interiorCondition)) * p.conditionPerLevel;
    case 'extCond': return (condIdx(subject.exteriorCondition) - condIdx(comp.exteriorCondition)) * p.conditionPerLevel;
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

// "No" / "Yes · 2 spaces" — shared by the grid and the report.
export function garageDisplay(p) {
  if (!p.hasGarage) return 'No';
  const n = num(p.garageSpaces);
  return n >= 1 ? `Yes · ${n} space${n === 1 ? '' : 's'}` : 'Yes';
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
    case 'air': return p.centralAir ? 'Yes' : 'No';
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
