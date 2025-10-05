// js/ctcae.js
// CTCAE: Common Terminology Criteria for Adverse Events (0–4 + note per item)
// Includes Enabled toggle and "Other" free-text. Writes immediately via Bus.

import { Utils } from './utils.js';

let Bus, State;

const CTCAE_FIELDS = [
  'Fatigue',
  'Sleep',
  'Nausea',
  'Vomiting',
  'Constipation',
  'Diarrhea',
  'Dyspnea',
  'Odynophagia',
  'Dysphagia',
  'Confusion/Delirium',
  'Peripheral Neuropathy',
  'Mucositis'
];

const MAX_SCORE = 4;

export const CTCAE = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },

  /** الحصول على سجل CTCAE لمريض (أو إنشاء قالب فارغ دون كتابة) */
  getForPatient(code, ctcaeArray) {
    const found = (ctcaeArray || State.ctcae).find(r => r['Patient Code'] === code);
    return found || makeEmptyRecord(code);
  },

  /** إدراج/تحديث محلي داخل State.ctcae */
  upsertLocal(ctcaeArray, record) {
    const arr = ctcaeArray || State.ctcae;
    const i = arr.findIndex(r => r['Patient Code'] === record['Patient Code']);
    if (i >= 0) arr[i] = record;
    else arr.push(record);
  },

  /** يرسم شبكة CTCAE داخل #ctcae-grid ويربط مفاتيح التبديل */
  render(patientCode, record) {
    const grid = document.getElementById('ctcae-grid');
    const enabledToggle = document.getElementById('ctcae-enabled');
    const otherField = document.getElementById('ctcae-other');
    const updatedAtEl = document.getElementById('ctcae-updated');
    if (!grid || !enabledToggle || !otherField || !updatedAtEl) return;

    grid.innerHTML = '';

    // حالة عمل محلية
    const current = { ...makeEmptyRecord(patientCode), ...record };

    // Initial UI
    enabledToggle.checked = truthy(current['Enabled']);
    otherField.value = current['Other'] || '';
    updatedAtEl.textContent = 'Updated: ' + (current['Updated At'] ? Utils.formatDateTime(current['Updated At']) : '—');

    // إنشاء العناصر لكل حقل
    CTCAE_FIELDS.forEach(name => {
      const item = createScoreItem({
        title: name,
        max: MAX_SCORE,
        value: normalizeScore(current[name]),
        noteValue: current[`${name} Note`] || '',
        disabled: !enabledToggle.checked
      });

      item.onScore = (score) => {
        current[name] = score === null ? '' : String(score);
        if (score === null) {
          current[`${name} Note`] = '';
          item.setNote('');
        }
        touchAndEmit(patientCode, current, updatedAtEl);
      };

      item.onNote = (txt) => {
        current[`${name} Note`] = txt;
        touchAndEmit(patientCode, current, updatedAtEl);
      };

      grid.appendChild(item.root);
    });

    // تمكين/تعطيل
    enabledToggle.addEventListener('change', () => {
      const on = enabledToggle.checked;
      current['Enabled'] = on ? 'TRUE' : 'FALSE';
      // تعطيل/تمكين أزرار الدرجات وملاحظاتها بصريًا
      grid.querySelectorAll('.score-item').forEach(el => {
        el.style.opacity = on ? '1' : '.6';
        el.querySelectorAll('button,textarea,input').forEach(ctrl => (ctrl.disabled = !on));
      });
      touchAndEmit(patientCode, current, updatedAtEl);
    });

    // Other
    otherField.addEventListener('change', () => {
      current['Other'] = otherField.value || '';
      touchAndEmit(patientCode, current, updatedAtEl);
    });
    otherField.addEventListener('blur', () => {
      current['Other'] = otherField.value || '';
      touchAndEmit(patientCode, current, updatedAtEl);
    });
  }
};

// ====== Helpers ======

function makeEmptyRecord(code) {
  const base = { 'Patient Code': code, 'Enabled': 'FALSE', 'Other': '', 'Updated At': '' };
  CTCAE_FIELDS.forEach(name => {
    base[name] = '';
    base[`${name} Note`] = '';
  });
  return base;
}

function truthy(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1' || v === 'TRUE';
  return !!v;
}

function normalizeScore(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  return Math.min(MAX_SCORE, Math.max(0, Math.round(n)));
}

function touchAndEmit(code, current, updatedAtEl) {
  const ts = new Date().toISOString();
  current['Updated At'] = ts;
  if (updatedAtEl) updatedAtEl.textContent = 'Updated: ' + Utils.formatDateTime(ts);
  Bus.emit('ctcae.changed', { code, record: current });
}

/** عنصر تحكم درجة + ملاحظة، مشابه لـ ESAS */
function createScoreItem({ title, max, value = null, noteValue = '', disabled = false }) {
  const root = document.createElement('div');
  root.className = 'score-item';

  const head = document.createElement('div');
  head.className = 'score-head';

  const h = document.createElement('div');
  h.className = 'score-title';
  h.textContent = title;

  const select = document.createElement('div');
  select.className = 'score-select';

  const buttons = [];
  for (let i = 0; i <= max; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'score-btn';
    b.textContent = String(i);
    b.setAttribute('aria-label', `${title} ${i}`);
    b.addEventListener('click', () => {
      if (disabled) return;
      if (currentScore === i) {
        setActiveScore(null);
        onScore?.(null);
      } else {
        setActiveScore(i);
        onScore?.(i);
      }
    });
    buttons.push(b);
    select.appendChild(b);
  }

  head.appendChild(h);
  head.appendChild(select);

  const noteWrap = document.createElement('div');
  noteWrap.className = 'score-note';

  const noteField = document.createElement('textarea');
  noteField.rows = 2;
  noteField.placeholder = `${title} note…`;
  noteField.value = noteValue || '';
  noteField.addEventListener('change', () => !disabled && onNote?.(noteField.value));
  noteField.addEventListener('blur', () => !disabled && onNote?.(noteField.value));

  noteWrap.appendChild(noteField);

  root.appendChild(head);
  root.appendChild(noteWrap);

  // الحالة
  let currentScore = value;

  function setActiveScore(s) {
    currentScore = s;
    buttons.forEach((b, idx) => {
      b.classList.toggle('active', s === idx);
      b.disabled = disabled;
    });
    if (s === null || s === undefined) {
      root.classList.remove('has-score');
      noteWrap.style.display = 'none';
      noteField.value = '';
    } else {
      root.classList.add('has-score');
      noteWrap.style.display = '';
    }
    noteField.disabled = disabled;
  }

  let onScore = null;
  let onNote = null;

  setActiveScore(currentScore);
  // تطبيق حالة disabled الأولية بصريًا
  root.style.opacity = disabled ? '.6' : '1';

  return {
    root,
    onScore: (fn) => { onScore = fn; },
    onNote: (fn) => { onNote = fn; },
    setActiveScore,
    setNote: (txt) => { noteField.value = txt || ''; }
  };
}