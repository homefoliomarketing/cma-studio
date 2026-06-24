// Step 5 — the branded, printable CMA report.
// Renders letter-size "pages" styled for screen preview and for print/PDF.
import { el, money, signedMoney } from '../ui.js';
import { ITEM_DEFS } from '../state.js';
import { itemDisplay, garageDisplay, effectiveAdjustment, compTotal, adjustedPrice, estimate } from '../calc.js';

export function renderReport(root, ctx) {
  const cma = ctx.cma;
  const b = ctx.settings.branding;
  const S = ctx.settings;
  const est = estimate(cma, S);
  const value = cma.finalValue != null ? cma.finalValue : est.average;

  if (!cma.comps.length) {
    root.append(el('div', { class: 'card card-pad', style: 'text-align:center;padding:50px' },
      el('div', { style: 'font-size:34px' }, '📄'),
      el('h2', { style: 'margin:12px 0 8px' }, 'Nothing to report yet'),
      el('p', { class: 'muted', style: 'margin-bottom:18px' }, 'Add comparables and adjustments first.'),
      el('button', { class: 'btn btn-primary', onclick: () => ctx.go('comps') }, '← Back to comparables')));
    return;
  }

  // --- toolbar (screen only) ---
  const clientInput = el('input', { type: 'text', value: cma.clientName || '', placeholder: 'Client name (optional)', style: 'max-width:240px' });
  clientInput.addEventListener('input', () => { cma.clientName = clientInput.value; ctx.save(); rerenderDoc(); });
  const dateInput = el('input', { type: 'text', value: cma.asOf || '', style: 'max-width:180px' });
  dateInput.addEventListener('input', () => { cma.asOf = dateInput.value; ctx.save(); rerenderDoc(); });

  const toolbar = el('div', { class: 'report-toolbar' },
    el('div', { class: 'row', style: 'gap:14px;flex-wrap:wrap' },
      el('div', { class: 'field', style: 'gap:4px' }, el('label', {}, 'Prepared for'), clientInput),
      el('div', { class: 'field', style: 'gap:4px' }, el('label', {}, 'Date'), dateInput),
    ),
    el('div', { class: 'row', style: 'gap:8px' },
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => ctx.go('settings') }, '⚙ Branding & logo'),
      el('button', { class: 'btn btn-accent', onclick: () => window.print() }, '🖨  Print / Save as PDF'),
    ),
  );

  const docWrap = el('div', { class: 'report-wrap' });
  function rerenderDoc() {
    docWrap.innerHTML = '';
    docWrap.append(buildDoc());
  }

  function buildDoc() {
    const doc = el('div', { class: 'report', style: `--brand:${b.primary};--accent:${b.accent}` });
    doc.append(coverPage(), analysisPage(), gridPage());
    if (cma.actives.length) doc.append(activePage());
    appendixPages().forEach(p => doc.append(p));
    return doc;
  }

  // ---------------- pages ----------------
  function page(cls, ...kids) { return el('div', { class: 'report-page ' + (cls || '') }, ...kids); }

  function brandMark() {
    return b.logo
      ? el('img', { class: 'rp-logo', src: b.logo, alt: b.companyName })
      : el('div', { class: 'rp-logo-text' }, b.companyName || 'CENTURY 21');
  }

  function agentInitials() {
    const n = (b.agentName || b.companyName || '').trim();
    if (!n) return '★';
    return n.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
  function headshotEl(cls) {
    return b.headshot
      ? el('div', { class: 'rp-headshot ' + (cls || ''), style: `background-image:url(${b.headshot})` })
      : el('div', { class: 'rp-headshot rp-headshot-empty ' + (cls || '') }, agentInitials());
  }
  // Prominent agent banner for the cover.
  function agentBanner() {
    const name = b.agentName || b.companyName || 'Add your details in Settings';
    const sub = [b.agentTitle, (b.agentName && b.companyName) ? b.companyName : ''].filter(Boolean).join('  ·  ');
    const contacts = [b.phone, b.email].filter(Boolean);
    return el('div', { class: 'rp-agent-banner' },
      headshotEl('rp-headshot-lg'),
      el('div', { class: 'rp-agent-main' },
        el('div', { class: 'rp-agent-name' }, name),
        sub ? el('div', { class: 'rp-agent-title' }, sub) : null,
        contacts.length
          ? el('div', { class: 'rp-agent-contact' }, ...contacts.map(c => el('span', { class: 'rp-contact-item' }, c)))
          : null,
      ),
    );
  }
  // "Prepared by …" line that reinforces branding next to the recommendation.
  function agentContactLine() {
    const parts = [b.agentName, b.phone, b.email].filter(Boolean);
    if (!parts.length) return null;
    return el('div', { class: 'rp-concl-agent' }, 'Prepared by ', el('strong', {}, parts.join('  ·  ')));
  }

  function coverPage() {
    return page('cover',
      el('div', { class: 'rp-band' }, brandMark(), el('div', { class: 'rp-tagline' }, b.tagline || 'COMPARATIVE MARKET ANALYSIS')),
      cma.subject.photo
        ? el('div', { class: 'rp-hero', style: `background-image:url(${cma.subject.photo})` })
        : el('div', { class: 'rp-hero rp-hero-empty' }, el('span', {}, 'Subject Property')),
      el('div', { class: 'rp-cover-body' },
        el('div', {},
          el('div', { class: 'rp-eyebrow' }, b.tagline || 'Comparative Market Analysis'),
          el('div', { class: 'rp-address' }, cma.subject.address || 'Subject Property'),
          el('div', { class: 'rp-city' }, [cma.subject.city, cma.subject.style].filter(Boolean).join(' · ')),
        ),
        el('div', { class: 'rp-prepared' },
          cma.clientName ? el('span', {}, 'Prepared exclusively for ', el('strong', {}, cma.clientName)) : null,
          (cma.clientName && cma.asOf) ? el('span', { class: 'rp-muted' }, '  ·  ') : null,
          cma.asOf ? el('span', { class: cma.clientName ? 'rp-muted' : '' }, cma.asOf) : null,
        ),
      ),
      el('div', { class: 'rp-cover-foot' },
        agentBanner(),
      ),
    );
  }

  function statRow(prop) {
    const cells = [
      ['Beds', prop.bedsBg > 0 ? `${prop.bedsAg || 0}+${prop.bedsBg}` : (prop.bedsTotal ?? '—')],
      ['Baths', prop.bathsTotal ?? prop.bathsFull ?? '—'],
      ['Sq ft', prop.sqftRaw || (prop.sqftMid ? Number(prop.sqftMid).toLocaleString() : '—')],
      ['Lot', prop.lot || '—'],
      ['Garage', garageDisplay(prop)],
    ];
    return el('div', { class: 'rp-stats' }, ...cells.map(([k, v]) =>
      el('div', { class: 'rp-stat' }, el('div', { class: 'rp-stat-v' }, String(v)), el('div', { class: 'rp-stat-k' }, k))));
  }

  function analysisPage() {
    const subj = cma.subject;
    const subjectCard = el('div', { class: 'rp-subject' },
      subj.photo ? el('div', { class: 'rp-subject-photo', style: `background-image:url(${subj.photo})` }) : null,
      el('div', { class: 'rp-subject-info' },
        el('div', { class: 'rp-eyebrow' }, 'Subject property'),
        el('div', { class: 'rp-subject-addr' }, subj.address || '—'),
        statRow(subj),
      ),
    );

    const comps = est.rows.map((r, i) => {
      const photos = (r.comp.photos || []).slice(0, 4);
      return el('div', { class: 'rp-comp' },
        el('div', { class: 'rp-comp-photo', style: r.comp.photo ? `background-image:url(${r.comp.photo})` : '' }),
        el('div', { class: 'rp-comp-body' },
          el('div', { class: 'rp-comp-head' },
            el('span', { class: 'rp-comp-addr' }, r.comp.address || ('Comparable ' + (i + 1))),
            el('div', { class: 'rp-comp-adj' }, money(r.adjusted)),
          ),
          statRow(r.comp),
          el('div', { class: 'rp-comp-prices' },
            el('span', {}, 'Sold ', el('strong', {}, money(r.comp.salePrice))),
            el('span', { class: r.total > 0 ? 'pos' : r.total < 0 ? 'neg' : '' }, r.total ? signedMoney(r.total) + ' adjustments' : 'no adjustments'),
            el('span', {}, '→ Adjusted ', el('strong', {}, money(r.adjusted))),
          ),
          photos.length > 1 ? el('div', { class: 'rp-comp-gallery' }, ...photos.map(src => el('div', { class: 'rp-gthumb', style: `background-image:url(${src})` }))) : null,
        ),
      );
    });

    return page('analysis',
      runningHead(),
      el('div', { class: 'rp-section-title' }, 'The Property & Comparables'),
      subjectCard,
      el('div', { class: 'rp-comps' }, ...comps),
    );
  }

  function gridPage() {
    const comps = cma.comps;
    const items = cma.enabledItems.map(k => ITEM_DEFS.find(d => d.key === k)).filter(Boolean);
    const head = el('tr', {},
      el('th', {}, 'Feature'), el('th', {}, 'Subject Property'),
      ...comps.map((c, i) => el('th', {}, c.address || ('Comparable ' + (i + 1)))));
    const rows = items.map(item => el('tr', {},
      el('td', { class: 'rg-feat' }, item.label),
      el('td', { class: 'rg-subj' }, String(itemDisplay(item, cma.subject))),
      ...comps.map(c => {
        const adj = item.type === 'info' ? 0 : effectiveAdjustment(cma, c, item, S);
        return el('td', {}, el('div', { class: 'rg-val' }, String(itemDisplay(item, c))),
          adj ? el('div', { class: 'rg-adj ' + (adj > 0 ? 'pos' : 'neg') }, signedMoney(adj)) : null);
      })));
    cma.customRows.forEach(cr => rows.push(el('tr', {},
      el('td', { class: 'rg-feat' }, cr.label || 'Adjustment'), el('td', {}, '—'),
      ...comps.map(c => { const v = cr.amounts?.[c.id]; return el('td', {}, v ? el('div', { class: 'rg-adj ' + (v > 0 ? 'pos' : 'neg') }, signedMoney(v)) : '—'); }))));

    const foot = [
      el('tr', { class: 'rg-sum' }, el('td', {}, 'Sale price'), el('td', {}, '—'), ...comps.map(c => el('td', {}, c.salePrice ? money(c.salePrice) : '—'))),
      el('tr', { class: 'rg-sum' }, el('td', {}, 'Total adjustments'), el('td', {}, '—'), ...comps.map(c => { const t = compTotal(cma, c, S); return el('td', { class: t > 0 ? 'pos' : t < 0 ? 'neg' : '' }, signedMoney(t)); })),
      el('tr', { class: 'rg-final' }, el('td', {}, 'Adjusted value'), el('td', {}, '—'), ...comps.map(c => el('td', {}, money(adjustedPrice(c, compTotal(cma, c, S)))))),
    ];

    return page('grid-page',
      runningHead(),
      el('div', { class: 'rp-section-title' }, 'Adjustment Detail' ),
      el('table', { class: 'rg' }, el('thead', {}, head), el('tbody', {}, ...rows, ...foot)),
      el('div', { class: 'rp-conclusion' },
        el('div', {}, el('div', { class: 'rp-eyebrow' }, 'Suggested list price'),
          el('div', { class: 'rp-muted', style: 'font-size:11px;max-width:400px' },
            `Indicated value (average of adjusted comps): ${money(est.average)}${est.count >= 2 ? ` · range ${money(est.low)}–${money(est.high)}` : ''}. A CMA is an estimate based on comparable sales, not a formal appraisal.`),
          agentContactLine()),
        el('div', { class: 'rp-concl-value' }, money(value))),
    );
  }

  function activePage() {
    const cards = cma.actives.map((a, i) => el('div', { class: 'rp-active' },
      el('div', { class: 'rp-active-photo', style: a.photo ? `background-image:url(${a.photo})` : '' }),
      el('div', {},
        el('div', { class: 'rp-active-addr' }, a.address || ('Active ' + (i + 1))),
        el('div', { class: 'rp-muted' }, [a.bedsTotal ? a.bedsTotal + ' bed' : '', a.bathsTotal ? a.bathsTotal + ' bath' : '', a.sqftMid ? Number(a.sqftMid).toLocaleString() + ' sqft' : ''].filter(Boolean).join(' · ')),
        el('div', { class: 'rp-active-price' }, a.listPrice ? money(a.listPrice) : '—'),
      )));
    return page('active-page',
      runningHead(),
      el('div', { class: 'rp-section-title' }, 'Currently on the Market'),
      el('div', { class: 'rp-muted', style: 'margin-bottom:14px' }, 'Active listings the subject is competing against. Shown for context — not included in the estimated value.'),
      el('div', { class: 'rp-actives' }, ...cards));
  }

  function appendixPages() {
    const pages = [];
    cma.comps.forEach((c, ci) => (c.pages || []).forEach((url, pi) => {
      pages.push(page('appendix',
        el('div', { class: 'rp-appendix-cap' }, `Comparable ${ci + 1} — ${c.address || ''} — MLS page ${pi + 1}`),
        el('img', { class: 'rp-page-img', src: url })));
    }));
    return pages;
  }

  function runningHead() {
    return el('div', { class: 'rp-running' },
      el('span', {}, b.companyName || 'CENTURY 21'),
      el('span', {}, cma.subject.address || 'Comparative Market Analysis'));
  }

  rerenderDoc();
  root.append(toolbar, docWrap);
}
