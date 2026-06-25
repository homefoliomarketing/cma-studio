// Home dashboard — the landing page after login. A calm, premium jumping-off
// point: greet the agent, offer the primary actions (new / open / continue),
// and surface their most recent CMAs. Rendered synchronously; the recent list
// is filled in once listCmas() resolves.
import { el } from '../ui.js';
import { listCmas } from '../state.js';

export function renderHome(root, ctx) {
  const name = ctx.settings?.branding?.agentName || '';
  const first = name.trim().split(/\s+/)[0] || '';
  const greeting = first ? `Welcome back, ${first}` : 'Welcome to CMA Studio';

  // ---- Hero ----------------------------------------------------------------
  const hero = el('div', { class: 'home-hero' },
    el('div', { class: 'home-mark' }, el('img', { src: 'assets/cma-studio-mark.svg', alt: '' })),
    el('div', {},
      el('h1', { class: 'home-greeting' }, greeting),
      el('div', { class: 'home-sub' }, 'Build a comparative market analysis your clients will remember.'),
    ),
  );

  // ---- Primary action cards -----------------------------------------------
  const c = ctx.cma || {};
  const inProgress = !!(c.subject?.address || (c.comps && c.comps.length));

  const actionCard = (cls, glyph, title, sub, onclick) =>
    el('button', { class: 'home-card ' + cls, type: 'button', onclick },
      el('span', { class: 'home-card-ico' }, glyph),
      el('span', { class: 'home-card-body' },
        el('span', { class: 'home-card-title' }, title),
        el('span', { class: 'home-card-sub' }, sub),
      ),
      el('span', { class: 'home-card-go' }, '→'),
    );

  const cards = el('div', { class: 'home-cards' },
    actionCard('home-card-primary', '＋', 'Start a new CMA',
      'A fresh analysis from a blank slate.', () => ctx.newCma()),
    actionCard('', '⌖', 'Open a saved CMA',
      'Pick up any analysis you’ve saved.', () => ctx.go('saved')),
    inProgress
      ? actionCard('home-card-resume', '⏵',
          'Continue current CMA',
          (c.subject?.address || 'Untitled') + ' · resume where you left off',
          () => ctx.go(c.resumeStep || 'subject'))
      : null,
  );

  // ---- Recent CMAs (filled in asynchronously) ------------------------------
  const recentBody = el('div', { class: 'home-recent-body' },
    el('div', { class: 'home-recent-skel' },
      el('div', { class: 'home-skel-row' }),
      el('div', { class: 'home-skel-row' }),
      el('div', { class: 'home-skel-row' }),
    ),
  );

  const recent = el('div', { class: 'card card-pad home-recent' },
    el('div', { class: 'home-recent-head' },
      el('div', { class: 'section-label' }, 'Recent CMAs'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => ctx.go('saved') }, 'View all →'),
    ),
    recentBody,
  );

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const emptyState = () => el('div', { class: 'home-recent-empty' },
    el('div', { class: 'home-empty-ico' }, '🗂'),
    el('div', { class: 'home-empty-title' }, 'No saved CMAs yet'),
    el('div', { class: 'muted' }, 'Start your first one above — it’ll show up here.'),
  );

  const recentRow = (it) => el('div', {
    class: 'home-recent-row', role: 'button', tabindex: '0',
    onclick: () => ctx.openCma(it.id),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.openCma(it.id); } },
  },
    el('div', { class: 'home-recent-main' },
      el('div', { class: 'home-recent-title' }, it.title || 'Untitled CMA'),
      el('div', { class: 'home-recent-date muted' }, fmtDate(it.savedAt)),
    ),
    el('span', { class: 'home-recent-open' }, 'Open →'),
  );

  (async () => {
    try {
      const items = await listCmas();
      recentBody.innerHTML = '';
      if (!items || !items.length) { recentBody.append(emptyState()); return; }
      const list = el('div', { class: 'home-recent-list' });
      items.slice(0, 5).forEach(it => list.append(recentRow(it)));
      recentBody.append(list);
    } catch {
      recentBody.innerHTML = '';
      recentBody.append(emptyState());
    }
  })();

  // ---- Footer link to Settings --------------------------------------------
  const foot = el('div', { class: 'home-foot' },
    el('button', { class: 'home-foot-link', type: 'button', onclick: () => ctx.go('settings') },
      'Set up your brand, headshot & adjustment presets in Settings →'),
  );

  root.append(el('div', { class: 'home stagger' }, hero, cards, recent, foot));
}
