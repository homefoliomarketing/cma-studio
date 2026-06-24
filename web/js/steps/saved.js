// Saved CMAs — browse, open, and delete previously saved analyses.
import { el, flash } from '../ui.js';
import * as store from '../state.js';

export async function renderSaved(root, ctx) {
  const wrap = el('div', { class: 'card card-pad' },
    el('div', { class: 'section-label' }, 'Saved CMAs'),
    el('div', { class: 'panel-sub' },
      'Open a saved analysis to keep working on it, or remove ones you no longer need.'),
    el('div', { class: 'muted', id: 'saved-loading' }, 'Loading…'),
  );
  root.append(wrap);

  let items = [];
  try {
    items = await store.listCmas();
  } catch (e) {
    wrap.querySelector('#saved-loading')
      .replaceWith(el('div', { class: 'muted' }, 'Could not load saved CMAs.'));
    return;
  }

  const list = el('div', { class: 'saved-list' });

  const fmtDate = (iso) => {
    if (!iso) return 'Not dated';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Not dated';
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  };

  const open = async (it) => {
    try {
      const data = await store.openCma(it.id);
      window.App.cma = data;
      store.saveDraft(data);
      // Restore to the last *workflow* step if it's reachable, else the subject.
      const STEP_KEYS = ['subject', 'comps', 'adjustments', 'result', 'report'];
      const target = STEP_KEYS.includes(data.step) ? data.step : 'subject';
      const gated = ['adjustments', 'result', 'report'].includes(target);
      const ok = !gated || (data.comps || []).length >= 1;
      window.App.go(ok ? target : 'subject');
    } catch (e) {
      flash('Could not open: ' + e.message);
    }
  };

  const del = async (it) => {
    if (!confirm(`Delete “${it.title || 'Untitled CMA'}”? This can’t be undone.`)) return;
    try {
      await store.deleteCma(it.id);
      items = items.filter(x => x.id !== it.id);
      render();
      flash('Deleted');
    } catch (e) {
      flash('Could not delete: ' + e.message);
    }
  };

  function row(it) {
    return el('div', { class: 'saved-row' },
      el('div', { class: 'saved-main', onclick: () => open(it) },
        el('div', { class: 'saved-title' }, it.title || 'Untitled CMA'),
        el('div', { class: 'saved-date muted' }, fmtDate(it.savedAt)),
      ),
      el('div', { class: 'saved-actions' },
        el('button', { class: 'btn btn-sm btn-primary', onclick: () => open(it) }, 'Open'),
        el('button', { class: 'btn btn-sm', onclick: () => del(it) }, 'Delete'),
      ),
    );
  }

  function render() {
    list.innerHTML = '';
    if (!items.length) {
      list.append(el('div', { class: 'saved-empty' },
        el('div', { class: 'ico' }, '🗂'),
        el('div', { class: 'big' }, 'No saved CMAs yet'),
        el('div', { class: 'muted' }, 'Build a CMA and press Save — it’ll show up here.'),
      ));
      return;
    }
    items.forEach(it => list.append(row(it)));
  }

  render();
  wrap.querySelector('#saved-loading').replaceWith(list);
}
