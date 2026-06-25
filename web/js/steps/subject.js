// Step 1 — the realtor's subject property.
import { el, flash } from '../ui.js';
import { CONDITION_LEVELS, HEATING_OPTIONS, AC_OPTIONS, STYLE_OPTIONS, BASEMENT_OPTIONS, BASEMENT_FINISH_OPTIONS, uploadPdf, applyUpload } from '../state.js';
import { textField, stepper, chipsField, photoField, optionField, garageField } from '../forms.js';

export function renderSubject(root, ctx) {
  const s = ctx.cma.subject;
  const save = ctx.save;

  const recomputeBeds = () => { s.bedsTotal = (Number(s.bedsAg) || 0) + (Number(s.bedsBg) || 0); save(); };
  const recomputeBaths = () => { s.bathsTotal = (Number(s.bathsFull) || 0) + (Number(s.bathsHalf) || 0); save(); };
  recomputeBeds(); recomputeBaths();

  // Basement finish only applies when there's a basement — toggle its visibility.
  const finishField = optionField('Basement finish', s, 'basementFinish', BASEMENT_FINISH_OPTIONS, { noOther: true, onChange: save });
  const updateFinishVis = () => { finishField.style.display = (s.basement && !/none/i.test(s.basement)) ? '' : 'none'; };
  const basementField = optionField('Basement', s, 'basement', BASEMENT_OPTIONS, {
    onChange: () => { if (!s.basement || /none/i.test(s.basement)) s.basementFinish = ''; updateFinishVis(); save(); },
  });
  updateFinishVis();

  // --- Auto-fill from MLS (compact, secondary affordance) ---
  // The form is the focal point now; this is a small button (also a drop
  // target) tucked above the first card. Reuses the same parse+apply flow.
  const handleFile = async (file) => {
    if (!file) return;
    bar.classList.add('drag');
    flash('Reading the MLS PDF…');
    try {
      const result = await uploadPdf(file, ctx.cma.id);
      applyUpload(s, result);
      recomputeBeds(); recomputeBaths();
      ctx.save();
      ctx.refresh();
      flash('Auto-filled from MLS ✓');
    } catch (e) {
      flash('Could not read that PDF: ' + e.message);
      bar.classList.remove('drag');
    }
  };

  const pdfInput = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none' });
  pdfInput.addEventListener('change', () => { if (pdfInput.files[0]) handleFile(pdfInput.files[0]); pdfInput.value = ''; });

  const bar = el('button', { class: 'subject-autofill', type: 'button' },
    el('span', { class: 'sa-ico' }, '📄'),
    el('span', { class: 'sa-text' }, 'Auto-fill from an MLS PDF'),
    el('span', { class: 'sa-hint' }, 'drop a file or click'),
    pdfInput,
  );
  bar.addEventListener('click', () => pdfInput.click());
  bar.addEventListener('dragover', (e) => { e.preventDefault(); bar.classList.add('drag'); });
  bar.addEventListener('dragleave', () => bar.classList.remove('drag'));
  bar.addEventListener('drop', (e) => {
    e.preventDefault(); bar.classList.remove('drag');
    const f = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (f) handleFile(f);
  });

  const autofill = el('div', { class: 'subject-autofill-bar' }, bar);

  const sections = el('div', { class: 'stagger' },
    autofill,

    card('Address',
      grid(
        textField('Street address', s, 'address', { ph: '428 North St', onChange: save }),
        textField('City', s, 'city', { onChange: save }),
      ),
    ),

    card('Size & rooms',
      grid(
        stepper('Bedrooms above grade', s, 'bedsAg', { onChange: recomputeBeds }),
        stepper('Bedrooms below grade', s, 'bedsBg', { onChange: recomputeBeds }),
        stepper('Full bathrooms', s, 'bathsFull', { onChange: recomputeBaths }),
        stepper('Half bathrooms', s, 'bathsHalf', { onChange: recomputeBaths }),
        textField('Living area (sq ft)', s, 'sqftRaw', { wide: true, ph: 'e.g. 1,500 or a range like 1,400–1,600', hint: 'a range is fine', onChange: save }),
        textField('Lot size', s, 'lot', { ph: '50 x 235', onChange: save }),
        optionField('Style', s, 'style', STYLE_OPTIONS, { wide: true, onChange: save }),
      ),
    ),

    card('Features',
      grid(
        garageField('Garage', s, { onChange: save }),
        basementField,
        finishField,
        optionField('Heating', s, 'heating', HEATING_OPTIONS, { wide: true, onChange: save }),
        optionField('Air Conditioning', s, 'ac', AC_OPTIONS, { onChange: save }),
        textField('Age', s, 'age', { hint: 'optional', onChange: save }),
      ),
    ),

    card('Condition',
      grid(
        chipsField('Interior condition', s, 'interiorCondition', CONDITION_LEVELS, { wide: true, onChange: save }),
        chipsField('Exterior condition', s, 'exteriorCondition', CONDITION_LEVELS, { wide: true, onChange: save }),
      ),
    ),

    card('Photo & notes',
      grid(
        photoField('Subject photo', s, 'photo', { onChange: save }),
        textField('Notes', s, 'notes', { wide: true, onChange: save }),
      ),
    ),

    el('div', { class: 'row spread', style: 'margin-top:6px' },
      el('div', { class: 'muted' }, 'Everything autosaves as you go.'),
      el('button', { class: 'btn btn-primary', onclick: () => ctx.next() }, 'Continue to comparables  →'),
    ),
  );

  root.append(sections);
}

function card(title, body) {
  return el('div', { class: 'card card-pad' }, el('div', { class: 'section-label' }, title), body);
}
function grid(...fields) {
  return el('div', { class: 'form-grid' }, ...fields.filter(Boolean));
}
