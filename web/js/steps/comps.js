// Step 2 — comparables (sold, used for the math) + active competition (context only).
import { el, flash, money } from '../ui.js';
import { CONDITION_LEVELS, HEATING_OPTIONS, AC_OPTIONS, STYLE_OPTIONS, BASEMENT_OPTIONS, BASEMENT_FINISH_OPTIONS, blankComp, blankActive, uploadPdf, applyUpload } from '../state.js';
import { textField, moneyField, numberField, stepper, chipsField, optionField, garageField } from '../forms.js';

const MAX_COMPS = 4;
const MAX_ACTIVES = 6;

export function renderComps(root, ctx) {
  const cma = ctx.cma;

  const intro = el('div', { class: 'card card-pad' },
    el('div', { class: 'section-label' }, 'Sold comparables'),
    el('div', { class: 'panel-sub', style: 'margin-bottom:0' },
      'Add 2–4 recently ', el('strong', {}, 'sold'), ' properties. Drop each MLS PDF below — it’s read automatically, photos and all. Then check the details (the MLS can miscount baths when there’s an ensuite) and fix anything before you adjust.'),
  );

  const compList = el('div', { class: 'stagger comp-list' });
  cma.comps.forEach((comp, i) => compList.append(compCard(comp, i, ctx)));
  if (cma.comps.length < MAX_COMPS) {
    compList.append(makeDropzone(ctx, {
      title: 'Drop a sold MLS PDF here', hint: 'or click to choose · add several at once',
      list: cma.comps, make: blankComp, max: MAX_COMPS, source: 'auto',
    }));
  }

  // --- Active competition (optional, display-only) ---
  const activeIntro = el('div', { class: 'card card-pad' },
    el('div', { class: 'section-label' }, 'Active competition · optional'),
    el('div', { class: 'panel-sub', style: 'margin-bottom:0' },
      'Currently-listed homes the subject is competing against. These ', el('strong', {}, 'don’t affect the estimated value'), ' — they just show buyers and sellers what else is on the market right now. Add as many or as few as you like.'),
  );
  const activeList = el('div', { class: 'stagger comp-list' });
  cma.actives.forEach((a, i) => activeList.append(activeCard(a, i, ctx)));
  if (cma.actives.length < MAX_ACTIVES) {
    activeList.append(makeDropzone(ctx, {
      title: 'Drop an active listing’s MLS PDF', hint: 'optional · shown in the report for context',
      list: cma.actives, make: blankActive, max: MAX_ACTIVES, source: 'auto',
    }));
  }

  const footer = el('div', { class: 'row spread', style: 'margin-top:24px' },
    el('div', { class: 'muted' }, `${cma.comps.length} of ${MAX_COMPS} sold comps` + (cma.comps.length < 2 ? ' · add at least 2 for a solid analysis' : '')),
    el('button', {
      class: 'btn btn-primary', disabled: cma.comps.length < 1 ? '' : null,
      onclick: () => ctx.next(),
    }, 'Continue to adjustments  →'),
  );

  root.append(intro, compList,
    el('div', { style: 'margin-top:30px' }, activeIntro),
    activeList, footer);
}

function makeDropzone(ctx, opts) {
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, style: 'display:none' });
  const zone = el('div', { class: 'dropzone' },
    el('div', { class: 'ico' }, '📄'),
    el('div', { class: 'big' }, opts.title),
    el('div', { class: 'muted' }, opts.hint),
    input,
  );
  const handle = async (files) => {
    for (const file of files) {
      if (opts.list.length >= opts.max) { flash(`Up to ${opts.max}.`); break; }
      flash('Reading ' + file.name + '…');
      try {
        const result = await uploadPdf(file, ctx.cma.id);
        const rec = applyUpload(opts.make(), result);
        rec.source = opts.source;
        rec.bedsTotal = (Number(rec.bedsAg) || 0) + (Number(rec.bedsBg) || 0);
        rec.bathsTotal = (Number(rec.bathsFull) || 0) + (Number(rec.bathsHalf) || 0);
        opts.list.push(rec);
        ctx.save();
        flash('Added ✓');
      } catch (e) {
        flash('Could not read ' + file.name + ': ' + e.message);
      }
    }
    ctx.refresh();
  };
  input.addEventListener('change', () => { if (input.files.length) handle([...input.files]); input.value = ''; });
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag');
    const pdfs = [...e.dataTransfer.files].filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length) handle(pdfs);
  });
  return zone;
}

// Photos are NOT loaded while working through comparables (the realtor has
// already seen them) — they stay collapsed behind a toggle so no image bytes
// load until clicked. The photo data (rec.photo/photos/pages) is untouched and
// the report still renders it. Click a thumbnail to choose the hero (rec.photo).
function photosControl(rec, ctx) {
  const count = (rec.photos && rec.photos.length) || (rec.photo ? 1 : 0);
  const wrap = el('div', { class: 'comp-photos' });

  const toggle = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button',
    style: 'margin:10px 14px 0',
  }, count ? `🖼 Show ${count} photo${count === 1 ? '' : 's'}` : '🏠 No photos');
  if (!count) { toggle.disabled = ''; wrap.append(toggle); return wrap; }

  const gallery = el('div', { style: 'display:none' });
  let built = false;
  const build = () => {
    const hero = el('div', {
      class: 'comp-hero' + (rec.photo ? '' : ' empty'),
      style: rec.photo ? `background-image:url(${rec.photo})` : '',
    }, rec.photo ? '' : el('span', { class: 'muted' }, '🏠 No photo found'));
    gallery.append(hero);
    if (rec.photos && rec.photos.length > 1) {
      gallery.append(el('div', { class: 'comp-thumbs' },
        ...rec.photos.map(src => el('div', {
          class: 'comp-thumb' + (src === rec.photo ? ' on' : ''),
          style: `background-image:url(${src})`,
          onclick: () => { rec.photo = src; ctx.refresh(); },
        }))));
    }
  };

  toggle.addEventListener('click', () => {
    const show = gallery.style.display === 'none';
    if (show && !built) { build(); built = true; } // load images only on first open
    gallery.style.display = show ? '' : 'none';
    toggle.textContent = show ? '🖼 Hide photos' : `🖼 Show ${count} photo${count === 1 ? '' : 's'}`;
  });

  wrap.append(toggle, gallery);
  return wrap;
}

function compCard(comp, i, ctx) {
  const save = ctx.save;
  const recomputeBeds = () => { comp.bedsTotal = (Number(comp.bedsAg) || 0) + (Number(comp.bedsBg) || 0); save(); };
  const recomputeBaths = () => { comp.bathsTotal = (Number(comp.bathsFull) || 0) + (Number(comp.bathsHalf) || 0); save(); };

  const soldTag = comp.salePrice
    ? el('span', { class: 'tag good' }, 'Sold ' + money(comp.salePrice))
    : el('span', { class: 'tag warn', title: 'No sale price found — make sure this is a sold listing.' }, '⚠ No sale price');

  const header = el('div', { class: 'comp-head' },
    el('div', {},
      el('div', { class: 'comp-title' }, 'Comparable ' + (i + 1)),
      el('div', { class: 'muted', style: 'font-size:13px' }, [comp.address, comp.city].filter(Boolean).join(', ') || 'Address —'),
    ),
    el('div', { class: 'row', style: 'gap:8px' }, soldTag,
      el('button', { class: 'btn btn-ghost btn-sm', title: 'Remove this comparable', onclick: () => {
        if (!confirm('Remove Comparable ' + (i + 1) + '?')) return;
        delete ctx.cma.adjustments[comp.id];
        ctx.cma.comps.splice(i, 1);
        ctx.refresh();
      } }, '✕ Remove'),
    ),
  );

  const priceRow = el('div', { class: 'form-grid', style: 'margin-bottom:4px' },
    moneyField('Sale price', comp, 'salePrice', { onChange: save }),
    moneyField('List price', comp, 'listPrice', { onChange: save }),
  );

  // Basement finish only applies when there's a basement — toggle its visibility.
  const finishField = optionField('Basement finish', comp, 'basementFinish', BASEMENT_FINISH_OPTIONS, { noOther: true, onChange: save });
  const updateFinishVis = () => { finishField.style.display = (comp.basement && !/none/i.test(comp.basement)) ? '' : 'none'; };
  const basementField = optionField('Basement', comp, 'basement', BASEMENT_OPTIONS, {
    onChange: () => { if (!comp.basement || /none/i.test(comp.basement)) comp.basementFinish = ''; updateFinishVis(); save(); },
  });
  updateFinishVis();

  const details = el('details', { class: 'comp-details', open: '' },
    el('summary', {}, 'Property details — auto-read, please verify'),
    el('div', { class: 'form-grid three', style: 'margin-top:16px' },
      stepper('Beds above', comp, 'bedsAg', { onChange: recomputeBeds }),
      stepper('Beds below', comp, 'bedsBg', { onChange: recomputeBeds }),
      textField('Living area (sq ft)', comp, 'sqftRaw', { ph: 'e.g. 1,500', hint: 'range is fine', onChange: save }),
      stepper('Full baths', comp, 'bathsFull', { onChange: recomputeBaths }),
      stepper('Half baths', comp, 'bathsHalf', { onChange: recomputeBaths }),
      textField('Lot size', comp, 'lot', { onChange: save }),
    ),
    el('div', { class: 'form-grid', style: 'margin-top:14px' },
      optionField('Style', comp, 'style', STYLE_OPTIONS, { wide: true, onChange: save }),
      garageField('Garage', comp, { onChange: save }),
      basementField,
      finishField,
      optionField('Heating', comp, 'heating', HEATING_OPTIONS, { wide: true, onChange: save }),
      optionField('Air Conditioning', comp, 'ac', AC_OPTIONS, { onChange: save }),
    ),
    el('div', { class: 'form-grid', style: 'margin-top:4px' },
      chipsField('Interior condition', comp, 'interiorCondition', CONDITION_LEVELS, { wide: true, onChange: save }),
      chipsField('Exterior condition', comp, 'exteriorCondition', CONDITION_LEVELS, { wide: true, onChange: save }),
    ),
  );

  return el('div', { class: 'card comp-card' }, photosControl(comp, ctx),
    el('div', { class: 'card-pad' }, header, priceRow, details));
}

function activeCard(a, i, ctx) {
  const save = ctx.save;
  const header = el('div', { class: 'comp-head' },
    el('div', {},
      el('div', { class: 'comp-title' }, 'Active ' + (i + 1)),
      el('div', { class: 'muted', style: 'font-size:13px' }, [a.address, a.city].filter(Boolean).join(', ') || 'Address —'),
    ),
    el('div', { class: 'row', style: 'gap:8px' },
      a.listPrice ? el('span', { class: 'tag' }, 'On market · ' + money(a.listPrice)) : null,
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
        if (!confirm('Remove Active ' + (i + 1) + '?')) return;
        ctx.cma.actives.splice(i, 1);
        ctx.refresh();
      } }, '✕ Remove'),
    ),
  );
  const grid = el('div', { class: 'form-grid three' },
    moneyField('List price', a, 'listPrice', { onChange: save }),
    numberField('Bedrooms', a, 'bedsTotal', { onChange: save }),
    numberField('Bathrooms', a, 'bathsTotal', { onChange: save }),
    textField('Living area (sq ft)', a, 'sqftRaw', { ph: 'e.g. 1,500', onChange: save }),
    textField('Style', a, 'style', { onChange: save }),
    textField('Lot size', a, 'lot', { onChange: save }),
  );
  return el('div', { class: 'card comp-card active-card' }, photosControl(a, ctx),
    el('div', { class: 'card-pad' }, header, grid));
}
