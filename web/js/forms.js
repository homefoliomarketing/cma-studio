// Reusable, click-friendly form controls shared by Subject and Comps.
import { el, parseMoney } from './ui.js';

const plain = (n) => (n == null || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('en-CA');

export function textField(label, obj, key, opts = {}) {
  const input = el('input', { type: opts.type || 'text', value: obj[key] ?? '', placeholder: opts.ph || '' });
  input.addEventListener('input', () => { obj[key] = input.value; opts.onChange?.(); });
  return el('div', { class: 'field' + (opts.wide ? ' col-2' : '') },
    el('label', {}, label, opts.hint ? el('span', { class: 'hint' }, ' · ' + opts.hint) : null),
    input,
  );
}

export function moneyField(label, obj, key, opts = {}) {
  const input = el('input', { type: 'text', inputmode: 'numeric', value: plain(obj[key]) });
  input.addEventListener('input', () => { obj[key] = parseMoney(input.value); opts.onChange?.(); });
  input.addEventListener('blur', () => { input.value = plain(obj[key]); });
  return el('div', { class: 'field' + (opts.wide ? ' col-2' : '') },
    el('label', {}, label),
    el('div', { class: 'input-money' }, input),
  );
}

export function numberField(label, obj, key, opts = {}) {
  const input = el('input', { type: 'number', value: obj[key] ?? '', placeholder: opts.ph || '' });
  input.addEventListener('input', () => { obj[key] = input.value === '' ? null : Number(input.value); opts.onChange?.(); });
  return el('div', { class: 'field' + (opts.wide ? ' col-2' : '') },
    el('label', {}, label, opts.hint ? el('span', { class: 'hint' }, ' · ' + opts.hint) : null),
    input,
  );
}

export function stepper(label, obj, key, opts = {}) {
  const min = opts.min ?? 0;
  const val = el('span', { class: 'val' }, String(obj[key] ?? 0));
  const upd = (d) => {
    const v = Math.max(min, (Number(obj[key]) || 0) + d);
    obj[key] = v; val.textContent = String(v); opts.onChange?.();
  };
  return el('div', { class: 'field' },
    el('label', {}, label),
    el('div', { class: 'stepper' },
      el('button', { type: 'button', onclick: () => upd(-1) }, '−'),
      val,
      el('button', { type: 'button', onclick: () => upd(1) }, '+'),
    ),
  );
}

export function chipsField(label, obj, key, options, opts = {}) {
  const wrap = el('div', { class: 'chips' });
  options.forEach(o => {
    const chip = el('button', { type: 'button', class: 'chip' + (obj[key] === o ? ' on' : '') }, o);
    chip.addEventListener('click', () => {
      obj[key] = o;
      [...wrap.children].forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
      opts.onChange?.();
    });
    wrap.append(chip);
  });
  return el('div', { class: 'field' + (opts.wide ? ' col-2' : '') }, el('label', {}, label), wrap);
}

export function boolField(label, obj, key, opts = {}) {
  const wrap = el('div', { class: 'chips' });
  [['Yes', true], ['No', false]].forEach(([txt, v]) => {
    const chip = el('button', { type: 'button', class: 'chip' + (!!obj[key] === v ? ' on' : '') }, txt);
    chip.addEventListener('click', () => {
      obj[key] = v;
      [...wrap.children].forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
      opts.onChange?.();
    });
    wrap.append(chip);
  });
  return el('div', { class: 'field' }, el('label', {}, label), wrap);
}

// Reads an image file into a data URL and stores it on obj[key].
// Supports both click-to-choose and drag-and-drop.
export function photoField(label, obj, key, opts = {}) {
  const preview = el('div', {
    class: 'photo-preview',
    style: obj[key] ? `background-image:url(${obj[key]})` : '',
  }, obj[key] ? '' : el('span', { class: 'muted' }, '📷 Add photo or drop one here'));
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });

  const loadFile = (f) => {
    if (!f || !/^image\//.test(f.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      obj[key] = reader.result;
      preview.style.backgroundImage = `url(${reader.result})`;
      preview.textContent = '';
      opts.onChange?.();
    };
    reader.readAsDataURL(f);
  };

  input.addEventListener('change', () => loadFile(input.files[0]));
  preview.addEventListener('click', () => input.click());
  preview.addEventListener('dragover', (e) => { e.preventDefault(); preview.classList.add('drag'); });
  preview.addEventListener('dragleave', () => preview.classList.remove('drag'));
  preview.addEventListener('drop', (e) => {
    e.preventDefault(); preview.classList.remove('drag');
    loadFile([...e.dataTransfer.files].find(f => /^image\//.test(f.type)));
  });
  return el('div', { class: 'field' }, el('label', {}, label), preview, input);
}

// PDF dropzone. onFile(file) is called with the chosen file.
export function dropzone(title, hint, onFile) {
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none' });
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
  const zone = el('div', { class: 'dropzone' },
    el('div', { class: 'ico' }, '📄'),
    el('div', { class: 'big' }, title),
    el('div', { class: 'muted' }, hint),
    input,
  );
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag');
    const f = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (f) onFile(f);
  });
  return zone;
}

// Click-to-select chips with an "Other → type it in" escape hatch.
// Pass opts.noOther to drop the Other button (fixed list only).
export function optionField(label, obj, key, options, opts = {}) {
  const wrap = el('div', { class: 'chips' });
  const other = el('input', { type: 'text', class: 'chip-other', placeholder: opts.otherPh || 'Type it in…' });
  const startedPreset = options.includes(obj[key]);
  const setOn = (node) => { [...wrap.children].forEach(c => c.classList.remove('on')); node?.classList.add('on'); };
  const showOther = (on) => { other.style.display = on ? '' : 'none'; };

  options.forEach(o => {
    const chip = el('button', { type: 'button', class: 'chip' + (obj[key] === o ? ' on' : '') }, o);
    chip.addEventListener('click', () => { obj[key] = o; setOn(chip); showOther(false); opts.onChange?.(); });
    wrap.append(chip);
  });

  if (!opts.noOther) {
    const otherChip = el('button', { type: 'button', class: 'chip' + ((!startedPreset && obj[key]) ? ' on' : '') }, 'Other');
    otherChip.addEventListener('click', () => {
      if (options.includes(obj[key])) obj[key] = '';
      setOn(otherChip); showOther(true); other.focus(); opts.onChange?.();
    });
    wrap.append(otherChip);
  }

  other.value = (!startedPreset && obj[key]) ? obj[key] : '';
  showOther(!opts.noOther && !startedPreset && !!obj[key]);
  other.addEventListener('input', () => { obj[key] = other.value; opts.onChange?.(); });

  return el('div', { class: 'field' + (opts.wide ? ' col-2' : '') }, el('label', {}, label), wrap, opts.noOther ? null : other);
}

// Garage Yes/No with a "number of spaces" stepper that appears only on "Yes".
// Reads/writes obj.hasGarage (bool) and obj.garageSpaces (number).
export function garageField(label, obj, opts = {}) {
  const spaces = el('div', { class: 'subfield' });
  const drawSpaces = () => {
    spaces.innerHTML = '';
    if (!obj.hasGarage) { spaces.style.display = 'none'; return; }
    spaces.style.display = '';
    const val = el('span', { class: 'val' }, String(obj.garageSpaces || 1));
    const bump = (d) => { obj.garageSpaces = Math.max(1, (Number(obj.garageSpaces) || 1) + d); val.textContent = String(obj.garageSpaces); opts.onChange?.(); };
    spaces.append(
      el('label', { class: 'sublabel' }, 'Number of spaces'),
      el('div', { class: 'stepper' },
        el('button', { type: 'button', onclick: () => bump(-1) }, '−'),
        val,
        el('button', { type: 'button', onclick: () => bump(1) }, '+')),
    );
  };
  const chips = el('div', { class: 'chips' });
  [['Yes', true], ['No', false]].forEach(([txt, v]) => {
    const chip = el('button', { type: 'button', class: 'chip' + (!!obj.hasGarage === v ? ' on' : '') }, txt);
    chip.addEventListener('click', () => {
      obj.hasGarage = v;
      if (v && !(obj.garageSpaces > 0)) obj.garageSpaces = 1;
      if (!v) obj.garageSpaces = 0;
      [...chips.children].forEach(c => c.classList.remove('on')); chip.classList.add('on');
      drawSpaces(); opts.onChange?.();
    });
    chips.append(chip);
  });
  drawSpaces();
  return el('div', { class: 'field' }, el('label', {}, label), chips, spaces);
}
