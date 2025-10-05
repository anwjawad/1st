// js/esas.js
// ESAS: Edmonton Symptom Assessment (0–10 + note per item)

import { Utils } from './utils.js';

let Bus, State;

const ESAS_FIELDS = [
  'Pain',
  'Tiredness',
  'Drowsiness',
  'Nausea',
  'Lack of Appetite',
  'Shortness of Breath',
  'Depression',
  'Anxiety',
  'Wellbeing'
];

const MAX_SCORE = 10;

export const ESAS = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },

  /** يعيد سجل ESAS لمريض؛ إذا غير موجود يُنشئ قالبًا فارغًا (لا يكتب لـ Sheets) */
  getForPatient(code, esasArray) {
    const found = (esasArray || State.esas).find(r => r['Patient Code'] === code);
    return found || makeEmptyRecord(code);
  },

  /** تحديث أو إدراج محليًا داخل State.esas */
  upsertLocal(esasArray, record) {
    const arr = esasArray || State.esas;
    const i = arr.findIndex(r => r['Patient Code'] === record['Patient Code']);
    if (i >= 0) arr[i] = record;
    else arr.push(record);
  },

  /** يرسم شبكة ESAS داخل #esas-grid للمريض المحدد */
  render(patientCode, record) {
    const grid = document.getElementById('esas-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // خزّن نسخة عاملة محليًا لنرسلها عند التغييرات
    const current = { ...makeEmptyRecord(patientCode), ...record };

    // طابع وقت الواجهة
    updateUpdatedAt(current['Updated At']);

    ESAS_FIELDS.forEach(name => {
      const item = createScoreItem({
        title: name,
        max: MAX_SCORE,
        value: normalizeScore(current[name]),
        noteValue: current[`${name} Note`] || ''
      });

      // عند النقر على درجة
      item.onScore = (score) => {
        current[name] = score === null ? '' : String(score);
        // إذا أزيلت الدرجة، أفرغ الملاحظة
        if (score === null) {
          current[`${name} Note`] = '';
          item.setNote('');
        }
        // حدّث واجهة العنصر
        item.setActiveScore(score);
        // تحديث الوقت
        const ts = new Date().toISOString();
        current['Updated At'] = ts;
        updateUpdatedAt(ts);
        // أرسل إلى Sheets
        emitChange(patientCode, current);
      };

      // عند تغيير الملاحظة
      item.onNote = (txt) => {
        current[`${name} Note`] = txt;
        const ts = new Date().toISOString();
        current['Updated At'] = ts;
        updateUpdatedAt(ts);
        emitChange(patientCode, current);
      };

      grid.appendChild(item.root);
    });
  }
};

// ====== Helpers ======

function makeEmptyRecord(code) {
  const base = { 'Patient Code': code, 'Updated At': '' };
  ESAS_FIELDS.forEach(name => {
    base[name] = '';
    base[`${name} Note`] = '';
  });
  return base;
}

function normalizeScore(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (Number.isNaN(n)) return null;
  return Math.min(MAX_SCORE, Math.max(0, Math.round(n)));
}

function updateUpdatedAt(ts) {
  const el = document.getElementById('esas-updated');
  if (!el) return;
  el.textContent = 'Updated: ' + (ts ? Utils.formatDateTime(ts) : '—');
}

function emitChange(code, record) {
  Bus.emit('esas.changed', { code, record });
}

/** يبني عنصر التحكم للعرض/الإدخال */
function createScoreItem({ title, max, value = null, noteValue = '' }) {
  const root = document.createElement('div');
  root.className = 'score-item';

  const head = document.createElement('div');
  head.className = 'score-head';

  const h = document.createElement('div');
  h.className = 'score-title';
  h.textContent = title;

  const select = document.createElement('div');
  select.className = 'score-select';

  // أزرار الدرجات 0..max
  const buttons = [];
  for (let i = 0; i <= max; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'score-btn';
    b.textContent = String(i);
    b.setAttribute('aria-label', `${title} ${i}`);
    b.addEventListener('click', () => {
      // إذا النقر على الدرجة النشطة نفسها → إلغاء الاختيار
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

  // خانة الملاحظة (تظهر فقط عند اختيار درجة)
  const noteWrap = document.createElement('div');
  noteWrap.className = 'score-note';

  const noteField = document.createElement('textarea');
  noteField.rows = 2;
  noteField.placeholder = `${title} note…`;
  noteField.value = noteValue || '';
  noteField.addEventListener('change', () => onNote?.(noteField.value));
  noteField.addEventListener('blur', () => onNote?.(noteField.value));

  noteWrap.appendChild(noteField);

  root.appendChild(head);
  root.appendChild(noteWrap);

  // حالة داخلية
  let currentScore = value;

  function setActiveScore(s) {
    currentScore = s;
    buttons.forEach((b, idx) => {
      b.classList.toggle('active', s === idx);
    });
    if (s === null || s === undefined) {
      root.classList.remove('has-score');
      // أخفِ الملاحظة إذا لا توجد درجة
      noteWrap.style.display = 'none';
      noteField.value = '';
    } else {
      root.classList.add('has-score');
      noteWrap.style.display = '';
    }
  }

  // ضبط الحالة الأولية
  setActiveScore(currentScore);

  let onScore = null;
  let onNote = null;

  return {
    root,
    onScore: (fn) => { onScore = fn; },
    onNote: (fn) => { onNote = fn; },
    setActiveScore,
    setNote: (txt) => { noteField.value = txt || ''; }
  };
}