import { el } from '../ui.js';

export function placeholder(title, body) {
  return el('div', { class: 'card card-pad', style: 'text-align:center; padding:60px 30px' },
    el('div', { style: 'font-size:38px' }, '✦'),
    el('h2', { style: 'font-size:30px; margin:14px 0 10px' }, title),
    el('p', { class: 'muted', style: 'max-width:520px; margin:0 auto; font-size:15.5px' }, body),
  );
}
