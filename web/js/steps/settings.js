// Settings — branding & adjustment presets. Personalizes every report.
import { el, flash, debounce } from '../ui.js';
import { defaultSettings, HEATING_OPTIONS } from '../state.js';
import { textField, moneyField, photoField } from '../forms.js';

export function renderSettings(root, ctx) {
  const s = ctx.settings;
  const b = s.branding;
  const p = s.presets;

  // Debounced persist so typing doesn't hammer the server on every keystroke.
  const persist = debounce(() => ctx.saveSettings(), 350);

  // Live sidebar name update (no full re-render → keeps the input focused).
  const touchSidebar = () => {
    const nm = document.querySelector('.sidebar .brand .name');
    if (nm) nm.textContent = b.companyName || 'CMA Studio';
  };

  const onText  = () => persist();
  const onName  = () => { persist(); touchSidebar(); };
  const onColor = () => { persist(); ctx.applyBranding(); };
  // Logo/headshot are discrete clicks — a full refresh shows them in the sidebar.
  const onPhoto = () => { ctx.saveSettings(); ctx.applyBranding(); ctx.refresh(); };
  const onPreset = () => persist();

  // ---- colour picker (not part of forms.js) -------------------------------
  function colorField(label, key) {
    const swatch = el('input', { type: 'color', class: 'color-swatch', value: b[key] || '#000000' });
    const hex = el('input', { type: 'text', class: 'color-hex', value: b[key] || '', spellcheck: 'false' });
    swatch.addEventListener('input', () => { b[key] = swatch.value; hex.value = swatch.value; onColor(); });
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (v && v[0] !== '#') v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { b[key] = v; swatch.value = v; onColor(); }
    });
    return el('div', { class: 'field' },
      el('label', {}, label),
      el('div', { class: 'color-row' }, swatch, hex),
    );
  }

  function resetBranding() {
    if (!confirm('Reset all branding to the Century 21 defaults? Your logo and colours will be cleared.')) return;
    Object.assign(b, defaultSettings().branding);
    ctx.saveSettings();
    ctx.applyBranding();
    ctx.refresh();
    flash('Branding reset to Century 21 defaults');
  }

  // ---- Branding -----------------------------------------------------------
  const branding = card('Branding',
    el('div', { class: 'panel-sub' },
      'Your company and agent details, logo, and colours — shown in the sidebar and on every report.'),
    grid(
      textField('Company name', b, 'companyName', { onChange: onName }),
      textField('Tagline', b, 'tagline', { hint: 'shown under the logo on reports', onChange: onText }),
      textField('Agent name', b, 'agentName', { onChange: onText }),
      textField('Agent title', b, 'agentTitle', { onChange: onText }),
      textField('Phone', b, 'phone', { type: 'tel', onChange: onText }),
      textField('Email', b, 'email', { type: 'email', onChange: onText }),
    ),
    el('div', { class: 'form-grid', style: 'margin-top:18px' },
      photoField('Logo', b, 'logo', { onChange: onPhoto }),
      photoField('Agent headshot', b, 'headshot', { onChange: onPhoto }),
      colorField('Brand colour', 'primary'),
      colorField('Accent colour', 'accent'),
    ),
    el('div', { class: 'row', style: 'margin-top:18px' },
      el('button', { class: 'btn btn-sm', onclick: resetBranding }, 'Reset to Century 21 defaults'),
    ),
  );

  // ---- Adjustment presets -------------------------------------------------
  const PRESET_FIELDS = [
    ['bedroomAbove',      'Per bedroom — above grade'],
    ['bedroomBelow',      'Per bedroom — below grade'],
    ['fullBath',          'Per full bathroom'],
    ['halfBath',          'Per half bathroom'],
    ['noGarage',          'Garage — having one (vs none)'],
    ['garageSpace',       'Garage — each extra space'],
    ['finishedBasement',  'Finished vs. unfinished basement'],
    ['centralAir',        'Central air — has vs. not'],
    ['conditionPerLevel', 'Per condition level'],
  ];

  const presets = card('Adjustment presets',
    el('div', { class: 'panel-sub' },
      'The default dollar value for each point of difference between your subject and a comp. ',
      el('strong', {}, 'Starting suggestions — set these to your market.'),
      ' Square footage, lot and style are adjusted by hand on each CMA. You can override any single adjustment while building a CMA.'),
    el('div', { class: 'form-grid three' },
      ...PRESET_FIELDS.map(([key, label]) => moneyField(label, p, key, { onChange: onPreset })),
    ),
    el('div', { class: 'section-label', style: 'margin-top:26px' }, 'Heating value by system'),
    el('div', { class: 'panel-sub' },
      'What each heating system is worth. Only the ', el('strong', {}, 'difference'),
      ' between the subject and a comp is applied (so Gas Forced Air vs Electric Baseboard adds $15,000). Gas & propane are estimates — set them to your market.'),
    el('div', { class: 'form-grid three' },
      ...HEATING_OPTIONS.map(opt => moneyField(opt, p.heating, opt, { onChange: onPreset })),
    ),
  );

  const saveBar = el('div', { class: 'row spread', style: 'margin-top:6px' },
    el('div', { class: 'muted' }, 'Settings save automatically and apply across the whole app.'),
    el('button', {
      class: 'btn btn-primary',
      onclick: () => { ctx.saveSettings(); ctx.applyBranding(); ctx.refresh(); flash('Settings saved ✓'); },
    }, 'Save & apply'),
  );

  root.append(el('div', { class: 'stagger' }, branding, presets, saveBar));
}

function card(title, ...body) {
  return el('div', { class: 'card card-pad' }, el('div', { class: 'section-label' }, title), ...body);
}
function grid(...fields) {
  return el('div', { class: 'form-grid' }, ...fields.filter(Boolean));
}
