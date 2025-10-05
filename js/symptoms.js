// js/symptoms.js
// Unified Patient’s Symptoms module (ESAS + CTCAE combined)
// - Tag-like selectable symptoms with optional inline notes
// - Writes immediately via Bus → Sheets.writePatientField for:
//     * "Symptoms" (comma-separated)
//     * "Symptoms Notes" (JSON map)
// - No numeric scales; selecting a symptom shows its note box
// - CTCAE enable toggle is not used anywhere

import { Utils } from './utils.js';

let Bus, State;

/** Canonicalization map to merge ESAS/CTCAE labels into a single list */
const CANON = {
  'Pain':'Pain',
  'Tiredness':'Fatigue',
  'Fatigue':'Fatigue',
  'Drowsiness':'Drowsiness',
  'Nausea':'Nausea',
  'Vomiting':'Vomiting',
  'Lack of Appetite':'Lack of Appetite',
  'Shortness of Breath':'Shortness of Breath',
  'Dyspnea':'Shortness of Breath',
  'Depression':'Depression',
  'Anxiety':'Anxiety',
  'Sleep':'Sleep Disturbance',
  'Sleep Disturbance':'Sleep Disturbance',
  'Dysphagia':'Dysphagia',
  'Odynophagia':'Odynophagia',
  'Constipation':'Constipation',
  'Diarrhea':'Diarrhea',
  'Confusion/Delirium':'Confusion/Delirium',
  'Peripheral Neuropathy':'Peripheral Neuropathy',
  'Mucositis':'Mucositis',
  'Wellbeing':'Wellbeing',
  'Other':'Other'
};

/** Display label for each canonical key (can hint synonyms) */
const DISPLAY = {
  'Pain':'Pain',
  'Fatigue':'Fatigue (Tiredness)',
  'Drowsiness':'Drowsiness',
  'Nausea':'Nausea',
  'Vomiting':'Vomiting',
  'Lack of Appetite':'Lack of Appetite',
  'Shortness of Breath':'Shortness of Breath (Dyspnea)',
  'Depression':'Depression',
  'Anxiety':'Anxiety',
  'Sleep Disturbance':'Sleep Disturbance',
  'Dysphagia':'Dysphagia',
  'Odynophagia':'Odynophagia',
  'Constipation':'Constipation',
  'Diarrhea':'Diarrhea',
  'Confusion/Delirium':'Confusion/Delirium',
  'Peripheral Neuropathy':'Peripheral Neuropathy',
  'Mucositis':'Mucositis',
  'Wellbeing':'Wellbeing',
  'Other':'Other'
};

/** Final unified symptoms list (canonical keys order) */
const UNIFIED_SYMPTOMS = [
  'Pain',
  'Fatigue',
  'Drowsiness',
  'Nausea',
  'Vomiting',
  'Lack of Appetite',
  'Shortness of Breath',
  'Depression',
  'Anxiety',
  'Sleep Disturbance',
  'Dysphagia',
  'Odynophagia',
  'Constipation',
  'Diarrhea',
  'Confusion/Delirium',
  'Peripheral Neuropathy',
  'Mucositis',
  'Wellbeing',
  'Other'
];

/** Normalize incoming array of selected symptoms to canonical keys */
function normalizeSelected(arr) {
  const out = new Set();
  (arr || []).forEach(s => {
    const k = (s || '').toString().trim();
    if (!k) return;
    const canon = CANON[k] || k;
    if (UNIFIED_SYMPTOMS.includes(canon)) out.add(canon);
  });
  return out;
}

/** Normalize notes object by canonical keys */
function normalizeNotes(obj) {
  const out = {};
  try {
    const entries = Object.entries(obj || {});
    entries.forEach(([k, v]) => {
      const canon = CANON[k] || k;
      if (!UNIFIED_SYMPTOMS.includes(canon)) return;
      const val = (v == null ? '' : String(v));
      if (val.trim()) out[canon] = val;
    });
  } catch { /* ignore */ }
  return out;
}

export const Symptoms = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },

  /**
   * Render unified symptoms UI in #symptoms-grid
   * @param {string} patientCode
   * @param {{symptoms:string[], notes:Object}} data
   */
  render(patientCode, data) {
    const grid = document.getElementById('symptoms-grid');
    const updatedAtEl = document.getElementById('symptoms-updated');
    if (!grid) return;

    grid.innerHTML = '';

    // Local working state
    const selected = normalizeSelected(data?.symptoms || []);
    const notes = normalizeNotes(data?.notes || {});
    let lastTs = '';

    function touchAndEmit() {
      const ts = new Date().toISOString();
      lastTs = ts;
      if (updatedAtEl) updatedAtEl.textContent = 'Updated: ' + Utils.formatDateTime(ts);
      // Emit to app → Sheets
      Bus.emit('symptoms.changed', {
        code: patientCode,
        symptoms: Array.from(selected.values()),
        notes: { ...notes }
      });
    }

    // Build each symptom item
    UNIFIED_SYMPTOMS.forEach(key => {
      const label = DISPLAY[key] || key;
      const item = makeSymptomItem({
        label,
        active: selected.has(key),
        noteValue: notes[key] || '',
        onToggle: (on) => {
          if (on) selected.add(key);
          else {
            selected.delete(key);
            delete notes[key];
          }
          touchAndEmit();
        },
        onNote: (txt) => {
          const v = (txt || '').trim();
          if (v) notes[key] = v;
          else delete notes[key];
          touchAndEmit();
        }
      });
      grid.appendChild(item.root);
    });

    // Initial timestamp display (if any saved previously is unknown here)
    if (updatedAtEl && !lastTs) updatedAtEl.textContent = 'Updated: —';
  }
};

// ===== UI Builders =====

function makeSymptomItem({ label, active=false, noteValue='', onToggle, onNote }) {
  const root = document.createElement('div');
  root.className = 'score-item';

  const head = document.createElement('div');
  head.className = 'score-head';

  const title = document.createElement('div');
  title.className = 'score-title';
  title.textContent = label;

  // Toggle chip (acts like checkbox)
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'symptom-chip';
  chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  chip.innerHTML = active ? '✓ Selected' : 'Select';

  // Note area (visible only when active)
  const noteWrap = document.createElement('div');
  noteWrap.className = 'score-note';
  const note = document.createElement('textarea');
  note.rows = 2;
  note.placeholder = `${label} note…`;
  note.value = active ? (noteValue || '') : '';
  noteWrap.appendChild(note);

  function setActive(on) {
    chip.classList.toggle('active', !!on);
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    chip.innerHTML = on ? '✓ Selected' : 'Select';
    if (on) {
      noteWrap.style.display = '';
    } else {
      noteWrap.style.display = 'none';
      note.value = '';
    }
  }

  chip.addEventListener('click', () => {
    const nowOn = !chip.classList.contains('active');
    setActive(nowOn);
    onToggle?.(nowOn);
    // When turning on, focus note for quick entry
    if (nowOn) setTimeout(() => note.focus(), 0);
  });

  note.addEventListener('change', () => onNote?.(note.value));
  note.addEventListener('blur', () => onNote?.(note.value));

  head.appendChild(title);
  head.appendChild(chip);

  root.appendChild(head);
  root.appendChild(noteWrap);

  // Initialize state
  setActive(active);

  return { root };
}
