// Settings — split into per-agent identity (everyone) and shared company brand
// + adjustment presets (admins only). The company brand and presets live in
// org_settings and are shared office-wide; an agent's name/title/phone/email/
// headshot live in their own profile.
import { el, flash, debounce } from '../ui.js';
import { defaultSettings, HEATING_OPTIONS } from '../state.js';
import { textField, moneyField, photoField } from '../forms.js';
import { listAgents, createAgent, deleteAgent, resetAgentPassword, currentUserId, genTempPassword } from '../admin.js';

export function renderSettings(root, ctx) {
  const s = ctx.settings;
  const b = s.branding;
  const p = s.presets;
  const admin = !!s.isAdmin;

  // Debounced persist so typing doesn't hammer the network on every keystroke.
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

  function resetCompanyBrand() {
    if (!confirm('Reset the company brand (name, tagline, logo, colours) to the Century 21 defaults?')) return;
    const d = defaultSettings().branding;
    b.companyName = d.companyName; b.tagline = d.tagline;
    b.primary = d.primary; b.accent = d.accent; b.logo = d.logo;
    ctx.saveSettings();
    ctx.applyBranding();
    ctx.refresh();
    flash('Company brand reset to Century 21 defaults');
  }

  // ---- Your details (every agent edits their own) -------------------------
  const agentCard = card('Your details',
    el('div', { class: 'panel-sub' },
      'Your name, title, and contact info — these appear on the reports you create. Each agent has their own.'),
    grid(
      textField('Your name', b, 'agentName', { onChange: onText }),
      textField('Title', b, 'agentTitle', { onChange: onText }),
      textField('Phone', b, 'phone', { type: 'tel', onChange: onText }),
      textField('Email', b, 'email', { type: 'email', onChange: onText }),
    ),
    el('div', { class: 'form-grid', style: 'margin-top:18px' },
      photoField('Your headshot', b, 'headshot', { onChange: onPhoto }),
    ),
  );

  const cards = [agentCard];

  if (admin) {
    // ---- Company branding (shared; admin only) ----------------------------
    const companyCard = card('Company branding · shared',
      el('div', { class: 'panel-sub' },
        'Your office’s brand — company name, tagline, logo, and colours. ',
        el('strong', {}, 'Shared with every agent in your office.')),
      grid(
        textField('Company name', b, 'companyName', { onChange: onName }),
        textField('Tagline', b, 'tagline', { hint: 'shown under the logo on reports', onChange: onText }),
      ),
      el('div', { class: 'form-grid', style: 'margin-top:18px' },
        photoField('Logo', b, 'logo', { onChange: onPhoto }),
        colorField('Brand colour', 'primary'),
        colorField('Accent colour', 'accent'),
      ),
      el('div', { class: 'row', style: 'margin-top:18px' },
        el('button', { class: 'btn btn-sm', onclick: resetCompanyBrand }, 'Reset company brand to Century 21 defaults'),
      ),
    );

    // ---- Adjustment presets (shared; admin only) --------------------------
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
    const presetsCard = card('Adjustment presets · shared',
      el('div', { class: 'panel-sub' },
        'The default dollar value for each point of difference between a subject and a comp. ',
        el('strong', {}, 'Shared office-wide — set these to your market.'),
        ' Square footage, lot and style are adjusted by hand on each CMA. Any single adjustment can still be overridden while building a CMA.'),
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

    cards.push(companyCard, presetsCard, manageAgentsCard());
  } else {
    // ---- Read-only company summary (non-admins) ---------------------------
    const ro = card('Company branding & presets · shared',
      el('div', { class: 'panel-sub' },
        'Your office’s brand and adjustment presets are managed by your office admin and shared across everyone. They apply automatically to your reports.'),
      el('div', { class: 'company-readonly' },
        b.logo ? el('img', { src: b.logo, class: 'ro-logo', alt: b.companyName }) : null,
        el('div', {},
          el('div', { class: 'ro-company' }, b.companyName || 'CENTURY 21'),
          el('div', { class: 'muted' }, b.tagline || ''),
        ),
      ),
    );
    cards.push(ro);
  }

  const saveBar = el('div', { class: 'row spread', style: 'margin-top:6px' },
    el('div', { class: 'muted' }, 'Settings save automatically and apply across the whole app.'),
    el('button', {
      class: 'btn btn-primary',
      onclick: () => { ctx.saveSettings(); ctx.applyBranding(); ctx.refresh(); flash('Settings saved ✓'); },
    }, 'Save & apply'),
  );

  root.append(el('div', { class: 'stagger' }, ...cards, saveBar));
}

function card(title, ...body) {
  return el('div', { class: 'card card-pad' }, el('div', { class: 'section-label' }, title), ...body);
}
function grid(...fields) {
  return el('div', { class: 'form-grid' }, ...fields.filter(Boolean));
}

// ---- Admin: add / remove agent accounts (admin-only) ----------------------
// Talks to the protected /api/admin/* endpoints (service.py). The card renders
// immediately with a "loading" state, then fills in the agent list async. If the
// server key isn't configured yet it shows the server's message instead of data.
function manageAgentsCard() {
  const listWrap = el('div', { class: 'agents-list' });

  const emailIn = el('input', { type: 'email', placeholder: 'agent@century21.ca', autocomplete: 'off' });
  const pwIn = el('input', { type: 'text', placeholder: 'Temporary password', autocomplete: 'off' });
  const genBtn = el('button', { class: 'btn btn-sm', type: 'button',
    onclick: () => { pwIn.value = genTempPassword(); } }, 'Generate');
  const addBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Add agent');
  const msg = el('div', { class: 'agents-msg' });

  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : 'never';

  function renderList(uid, agents) {
    listWrap.innerHTML = '';
    if (!agents.length) { listWrap.append(el('div', { class: 'muted' }, 'No agents yet.')); return; }
    const rows = agents
      .slice()
      .sort((a, b) => (a.email || '').localeCompare(b.email || ''))
      .map(a => {
        const isSelf = a.id === uid;
        const action = isSelf
          ? el('span', { class: 'muted' }, 'You')
          : el('div', { class: 'agent-actions' },
              el('button', { class: 'btn btn-sm', type: 'button', onclick: () => onReset(a) }, 'Reset password'),
              el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => onDelete(a) }, 'Delete'),
            );
        return el('div', { class: 'agent-row' },
          el('div', {},
            el('div', { class: 'agent-email' }, a.email || a.id),
            el('div', { class: 'muted agent-meta' }, `Created ${fmt(a.created_at)} · Last sign-in ${fmt(a.last_sign_in_at)}`),
          ),
          action,
        );
      });
    listWrap.append(el('div', { class: 'agents-table' }, ...rows));
  }

  async function refresh() {
    listWrap.innerHTML = '';
    listWrap.append(el('div', { class: 'muted' }, 'Loading agents…'));
    try {
      const [uid, agents] = await Promise.all([currentUserId(), listAgents()]);
      renderList(uid, agents);
    } catch (e) {
      listWrap.innerHTML = '';
      listWrap.append(el('div', { class: 'agents-msg err' }, e.message));
    }
  }

  async function onDelete(a) {
    if (!confirm(`Delete ${a.email}?\n\nThis permanently removes their account, saved CMAs and photos. This cannot be undone.`)) return;
    try { await deleteAgent(a.id); flash('Deleted ' + a.email); refresh(); }
    catch (e) { flash('Could not delete: ' + e.message); }
  }

  async function onReset(a) {
    if (!confirm(`Reset the password for ${a.email}?\n\nThey'll get a new temporary password and must choose their own on next login.`)) return;
    const pw = genTempPassword();
    try {
      await resetAgentPassword(a.id, pw);
      msg.className = 'agents-msg ok';
      msg.innerHTML = '';
      msg.append(
        el('div', {}, '✓ New password set for ', el('strong', {}, a.email)),
        el('div', {}, 'Temporary password: ', el('code', {}, pw)),
        el('div', { class: 'muted' }, 'Share it with them — they’ll choose their own on next login.'),
      );
      msg.scrollIntoView({ block: 'center' });
      flash('Password reset for ' + a.email);
    } catch (e) {
      flash('Could not reset: ' + e.message);
    }
  }

  addBtn.addEventListener('click', async () => {
    const email = emailIn.value.trim();
    let pw = pwIn.value.trim();
    msg.className = 'agents-msg'; msg.textContent = '';
    if (!email) { msg.className = 'agents-msg err'; msg.textContent = 'Enter the agent’s email.'; return; }
    if (!pw) { pw = genTempPassword(); pwIn.value = pw; }
    if (pw.length < 8) { msg.className = 'agents-msg err'; msg.textContent = 'Temporary password must be at least 8 characters.'; return; }
    addBtn.disabled = true; addBtn.textContent = 'Adding…';
    try {
      await createAgent(email, pw);
      msg.className = 'agents-msg ok';
      msg.innerHTML = '';
      msg.append(
        el('div', {}, '✓ Created ', el('strong', {}, email)),
        el('div', {}, 'Temporary password: ', el('code', {}, pw)),
        el('div', { class: 'muted' }, 'Share these with the agent — they’ll choose their own password on first login.'),
      );
      emailIn.value = ''; pwIn.value = '';
      refresh();
    } catch (e) {
      msg.className = 'agents-msg err';
      msg.textContent = e.message;
    } finally {
      addBtn.disabled = false; addBtn.textContent = 'Add agent';
    }
  });

  refresh();

  return card('Manage agents · admin',
    el('div', { class: 'panel-sub' },
      'Add or remove agent accounts for your office. New agents get a temporary password and must choose their own on first login.'),
    el('div', { class: 'agents-add' },
      el('div', { class: 'field' }, el('label', {}, 'New agent email'), emailIn),
      el('div', { class: 'field' }, el('label', {}, 'Temporary password'),
        el('div', { class: 'agents-pw' }, pwIn, genBtn)),
      el('div', { class: 'row' }, addBtn),
      msg,
    ),
    el('div', { class: 'section-label', style: 'margin-top:24px' }, 'Current agents'),
    listWrap,
  );
}
