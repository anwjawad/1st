// js/labs.js
// Labs module: render inputs, classify vs reference ranges, highlight abnormal,
// build summary chips, and sync immediately via Bus.

import { Utils } from './utils.js';

let Bus, State;

const LAB_FIELDS_ORDER = [
  'WBC',
  'HGB',
  'PLT',
  'ANC',
  'CRP',
  'Albumin',
  'CRP Trend',
  'Sodium (Na)',
  'Potassium (K)',
  'Chloride (Cl)',
  'Calcium (Ca)',
  'Phosphorus (Ph)',
  'Alkaline Phosphatase (ALP)',
  'Creatinine (Scr)',
  'BUN',
  'Total Bile',
  'Other',
  'Updated At'
];

// مرجع القيم الطبيعية (تقريبية شائعة للبالغين)
// NOTE: لا نُظهر الوحدات في الواجهة لتقليل الضجيج؛ يمكن إضافتها لاحقاً إذا رغبت.
const REF = {
  'WBC': [4.0, 11.0],
  'HGB': [12.0, 16.0],
  'PLT': [150, 450],
  'ANC': [1.5, 8.0],
  'CRP': [0, 5],
  'Albumin': [3.5, 5.0],
  'Sodium (Na)': [135, 145],
  'Potassium (K)': [3.5, 5.1],
  'Chloride (Cl)': [98, 107],
  'Calcium (Ca)': [8.5, 10.5],
  'Phosphorus (Ph)': [2.5, 4.5],
  'Alkaline Phosphatase (ALP)': [44, 147],
  'Creatinine (Scr)': [0.6, 1.3],
  'BUN': [7, 20],
  'Total Bile': [0.1, 1.2]
  // CRP Trend و Other ليست أرقامًا مقارنة
};

export const Labs = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },

  /** إعادة سجل المختبرات لمريض أو إنشاء قالب فارغ (لا كتابة) */
  getForPatient(code, labsArray) {
    const found = (labsArray || State.labs).find(r => r['Patient Code'] === code);
    return found || makeEmptyRecord(code);
  },

  /** إدراج/تحديث محلي */
  upsertLocal(labsArray, record) {
    const arr = labsArray || State.labs;
    const i = arr.findIndex(r => r['Patient Code'] === record['Patient Code']);
    if (i >= 0) arr[i] = record;
    else arr.push(record);
  },

  /** يرسم شبكة المختبرات ويطبق التلوين والملخّص */
  render(patientCode, record) {
    const grid = document.getElementById('labs-grid');
    const updatedAtEl = document.getElementById('labs-updated');
    const summaryRoot = document.getElementById('labs-summary');
    if (!grid || !updatedAtEl || !summaryRoot) return;

    grid.innerHTML = '';
    summaryRoot.innerHTML = '';

    // لا نكتب "Normal" في Sheets — نعرضه placeholder فقط.
    const current = { ...makeEmptyRecord(patientCode), ...record };

    // تحديث طابع الوقت
    updatedAtEl.textContent = 'Updated: ' + (current['Updated At'] ? Utils.formatDateTime(current['Updated At']) : '—');

    // مجموعة الحقول التي نعرضها كبطاقات
    const FIELDS = [
      'WBC','HGB','PLT','ANC','CRP','Albumin',
      'CRP Trend',
      'Sodium (Na)','Potassium (K)','Chloride (Cl)',
      'Calcium (Ca)','Phosphorus (Ph)',
      'Alkaline Phosphatase (ALP)',
      'Creatinine (Scr)','BUN','Total Bile',
      'Other'
    ];

    // نبني بطاقة لكل حقل
    FIELDS.forEach(key => {
      const el = makeLabCard({
        name: key,
        value: current[key] || '',
        ref: REF[key] || null,
        onChange: (val) => {
          current[key] = val;
          touchAndEmit(patientCode, current, updatedAtEl);
          // إعادة حساب الملخّص والتلوين
          recalcAll(grid, summaryRoot, current);
        }
      });
      if (key === 'Other') el.root.classList.add('other');
      grid.appendChild(el.root);
    });

    // بعد البناء الأولي: احسب التلوين والملخص
    recalcAll(grid, summaryRoot, current);
  }
};

// ====== Helpers ======

function makeEmptyRecord(code) {
  const base = { 'Patient Code': code, 'Updated At': '' };
  LAB_FIELDS_ORDER.forEach(f => {
    if (f === 'Updated At' || f === 'Patient Code') return;
    base[f] = '';
  });
  return base;
}

/** يصنّف قيمة رقمية مقارنة بالمرجع */
function classify(name, raw) {
  const ref = REF[name];
  if (!ref) return { status: 'normal', parsed: null };
  const n = parseNumber(raw);
  if (n === null) return { status: 'normal', parsed: null }; // نص/فارغ → نعتبرها طبيعية افتراضياً
  if (n < ref[0]) return { status: 'low', parsed: n, ref };
  if (n > ref[1]) return { status: 'high', parsed: n, ref };
  return { status: 'normal', parsed: n, ref };
}

/** يحاول استخراج رقم من سلسلة مدخلة */
function parseNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  // التقط أول رقم محتمل (يدعم القيم العشرية والسالبة)
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

/** يبني بطاقة مختبر قابلة للتحرير */
function makeLabCard({ name, value, ref, onChange }) {
  const root = document.createElement('div');
  root.className = 'lab';

  const head = document.createElement('div');
  head.className = 'lab-head';

  const title = document.createElement('div');
  title.className = 'lab-name';
  title.textContent = name;

  const refEl = document.createElement('div');
  refEl.className = 'muted small mono';
  refEl.textContent = ref ? `[${ref[0]}–${ref[1]}]` : '';

  head.appendChild(title);
  head.appendChild(refEl);

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Normal'; // افتراضيًا نعرض Normal
  input.value = value || '';

  input.addEventListener('change', () => onChange?.(input.value));
  input.addEventListener('blur', () => onChange?.(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  });

  root.appendChild(head);
  root.appendChild(input);

  // طريقة لمزامنة التلوين بحسب القيمة
  function setClassByValue(val) {
    root.classList.remove('abnormal-high', 'abnormal-low');
    const c = classify(name, val);
    if (c.status === 'high') root.classList.add('abnormal-high');
    if (c.status === 'low') root.classList.add('abnormal-low');
  }

  // حالة أولية
  setClassByValue(value);

  return {
    root,
    setClassByValue
  };
}

/** حدّث الطابع الزمني وأصدر حدث الكتابة إلى Sheets */
function touchAndEmit(code, current, updatedAtEl) {
  const ts = new Date().toISOString();
  current['Updated At'] = ts;
  if (updatedAtEl) updatedAtEl.textContent = 'Updated: ' + Utils.formatDateTime(ts);
  Bus.emit('labs.changed', { code, record: current });
}

/** إعادة حساب كل البطاقات + ملخص الشذوذ */
function recalcAll(grid, summaryRoot, current) {
  // تحديث تلوين كل بطاقة
  grid.querySelectorAll('.lab').forEach(card => {
    const name = card.querySelector('.lab-name')?.textContent?.trim();
    const input = card.querySelector('input');
    if (!name || !input) return;
    card.classList.remove('abnormal-high', 'abnormal-low');
    const c = classify(name, input.value);
    if (c.status === 'high') card.classList.add('abnormal-high');
    if (c.status === 'low') card.classList.add('abnormal-low');
  });

  // بناء الملخص: اعرض القيم الشاذّة + “Other” دائمًا
  summaryRoot.innerHTML = '';
  const chips = [];

  Object.keys(REF).forEach(name => {
    const val = current[name] || '';
    const c = classify(name, val);
    if (c.status === 'high' || c.status === 'low') {
      const chip = document.createElement('span');
      chip.className = 'chip ' + (c.status === 'high' ? 'high' : 'low');
      const arrow = c.status === 'high' ? '↑' : '↓';
      chip.textContent = `${name}: ${val || '(?)'} ${arrow}`;
      chips.push(chip);
    }
  });

  // Always show Other
  const otherTxt = current['Other'] || '';
  const otherChip = document.createElement('span');
  otherChip.className = 'chip';
  otherChip.textContent = otherTxt ? `Other: ${otherTxt}` : 'Other: —';
  chips.push(otherChip);

  chips.forEach(ch => summaryRoot.appendChild(ch));
}