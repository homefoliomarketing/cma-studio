// Main controller: app shell, step navigation, autosave.
import { el, $, flash, debounce } from './ui.js';
import { supabase } from './supa.js';
import { renderLogin, signOut } from './auth.js';
import * as store from './state.js';
import { renderSubject } from './steps/subject.js';
import { renderComps } from './steps/comps.js';
import { renderAdjustments } from './steps/adjustments.js';
import { renderResult } from './steps/result.js';
import { renderReport } from './steps/report.js';
import { renderSettings } from './steps/settings.js';
import { renderSaved } from './steps/saved.js';

const STEPS = [
  { key: 'subject',     n: 1, label: 'Subject property', sub: 'Your listing',      render: renderSubject },
  { key: 'comps',       n: 2, label: 'Comparables',       sub: 'Upload sold MLS',   render: renderComps },
  { key: 'adjustments', n: 3, label: 'Adjustments',       sub: 'Compare & adjust',  render: renderAdjustments },
  { key: 'result',      n: 4, label: 'Result',            sub: 'Estimated value',   render: renderResult },
  { key: 'report',      n: 5, label: 'Report',            sub: 'Print & export',    render: renderReport },
];

export const App = {
  cma: null,
  settings: null,

  async init() {
    this.guardStrayDrops();
    // Invite-only gate: no session -> show the login screen, then re-init.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      renderLogin($('#app'), () => this.init());
      return;
    }
    store.setAuthUid(session.user.id);
    this.settings = await store.loadSettings();
    this.cma = store.loadDraft() || store.newCMA();
    if (!this.cma.step) this.cma.step = 'subject';
    this.applyBranding();
    this.render();
  },

  // A file dropped OUTSIDE an upload area would otherwise make the browser
  // navigate to it — discarding the CMA. Swallow those stray file drops;
  // real dropzones/photo fields still handle drops inside them.
  guardStrayDrops() {
    ['dragover', 'drop'].forEach(ev =>
      window.addEventListener(ev, (e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        if (!e.target.closest?.('.dropzone, .photo-preview')) e.preventDefault();
      }));
  },

  // Push the realtor's brand colours into CSS variables so buttons, focus
  // rings, accents and the report all re-theme live when Settings change.
  applyBranding() {
    const b = this.settings.branding;
    const r = document.documentElement.style;
    r.setProperty('--brand', b.primary || '#252526');
    r.setProperty('--accent', b.accent || '#beaf87');
  },

  save: debounce(function () { store.saveDraft(App.cma); }, 300),

  // Re-render everything (used after structural changes / navigation)
  render() {
    const root = $('#app');
    root.innerHTML = '';
    root.append(this.sidebar(), this.main());
  },

  go(step) {
    if (!this.canAccess(step)) return;
    this.cma.step = step;
    store.saveDraft(this.cma);
    this.render();
    document.querySelector('.content')?.scrollIntoView({ block: 'start' });
  },

  // gating: need a subject before comps; need 2+ comps to adjust / report
  canAccess(step) {
    const c = this.cma;
    if (step === 'comps') return true;
    if (['adjustments', 'result', 'report'].includes(step)) return c.comps.length >= 1;
    return true;
  },

  stepState(step) {
    const c = this.cma;
    const done = {
      subject: !!(c.subject.address || c.subject.listPrice || c.subject.bedsTotal),
      comps: c.comps.length >= 1,
      adjustments: c.comps.length >= 1 && Object.keys(c.adjustments).length > 0,
      result: false, report: false,
    }[step];
    if (c.step === step) return 'active';
    if (!this.canAccess(step)) return 'disabled';
    return done ? 'done' : '';
  },

  sidebar() {
    const b = this.settings.branding;
    const markInner = b.logo
      ? el('img', { src: b.logo, alt: '' })
      : el('span', {}, (b.companyName || 'C')[0].toUpperCase());

    const brand = el('div', { class: 'brand' },
      el('div', { class: 'mark' }, markInner),
      el('div', {},
        el('div', { class: 'name' }, b.companyName || 'CMA Studio'),
        el('div', { class: 'sub' }, 'CMA Studio'),
      ),
    );

    const steps = el('ul', { class: 'steps' },
      ...STEPS.map(s => el('li', {
        class: 'step ' + this.stepState(s.key),
        onclick: () => this.go(s.key),
      },
        el('span', { class: 'num' }, el('span', {}, String(s.n))),
        el('span', { class: 'lbl' }, s.label, el('small', {}, s.sub)),
      )),
    );

    const foot = el('div', { class: 'sidebar-foot' },
      el('div', { class: 'step ' + (this.cma.step === 'settings' ? 'active' : ''), onclick: () => this.go('settings') },
        el('span', { class: 'num' }, el('span', {}, '⚙')),
        el('span', { class: 'lbl' }, 'Settings', el('small', {}, 'Presets & branding')),
      ),
      el('div', { class: 'step ' + (this.cma.step === 'saved' ? 'active' : ''), onclick: () => this.go('saved') },
        el('span', { class: 'num' }, el('span', {}, '🗂')),
        el('span', { class: 'lbl' }, 'Saved CMAs', el('small', {}, 'Open or remove')),
      ),
      el('div', { class: 'step', onclick: () => this.newCma() },
        el('span', { class: 'num' }, el('span', {}, '+')),
        el('span', { class: 'lbl' }, 'New CMA', el('small', {}, 'Start fresh')),
      ),
      el('div', { class: 'step sign-out', onclick: () => signOut() },
        el('span', { class: 'num' }, el('span', {}, '⎋')),
        el('span', { class: 'lbl' }, 'Sign out',
          el('small', {}, b.agentName || b.email || 'Signed in')),
      ),
    );

    return el('aside', { class: 'sidebar' }, brand, steps, foot);
  },

  main() {
    const step = STEPS.find(s => s.key === this.cma.step);
    const PAGES = {
      settings: { title: 'Settings',   crumb: 'Configuration' },
      saved:    { title: 'Saved CMAs', crumb: 'Library' },
    };
    const page = step
      ? { title: step.label, crumb: `Step ${step.n} of ${STEPS.length}` }
      : (PAGES[this.cma.step] || PAGES.settings);
    const title = page.title;
    const crumb = page.crumb;

    const topbar = el('div', { class: 'topbar' },
      el('div', {},
        el('div', { class: 'crumb' }, crumb),
        el('h2', {}, title),
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => this.saveNow() }, '💾 Save'),
        step && step.key !== 'report'
          ? el('button', { class: 'btn btn-primary btn-sm', onclick: () => this.next() }, 'Continue →')
          : null,
      ),
    );

    const content = el('div', { class: 'content' });
    const ctx = {
      cma: this.cma,
      settings: this.settings,
      go: (s) => this.go(s),
      next: () => this.next(),
      refresh: () => this.render(),
      save: () => this.save(),
      saveSettings: async () => { await store.persistSettings(this.settings); },
      applyBranding: () => this.applyBranding(),
    };
    const renderFn = step
      ? step.render
      : (this.cma.step === 'saved' ? renderSaved : renderSettings);
    renderFn(content, ctx);

    return el('main', { class: 'main' }, topbar, content);
  },

  next() {
    const order = STEPS.map(s => s.key);
    const i = order.indexOf(this.cma.step);
    for (let j = i + 1; j < order.length; j++) {
      if (this.canAccess(order[j])) return this.go(order[j]);
    }
  },

  async saveNow() {
    if (!this.cma.title) this.cma.title = this.cma.subject.address || 'Untitled CMA';
    try {
      await store.saveCmaToServer(this.cma);
      store.saveDraft(this.cma);
      flash('Saved ✓');
    } catch (e) {
      flash('Could not save: ' + e.message);
    }
  },

  newCma() {
    if (this.cma.subject.address || this.cma.comps.length) {
      if (!confirm('Start a new CMA? Your current one is saved as a draft only if you clicked Save.')) return;
    }
    this.cma = store.newCMA();
    this.render();
  },
};

window.App = App;
App.init();
