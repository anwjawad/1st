// js/dashboard.js
// Patient Dashboard binder: populate bio fields, text areas, ESAS, CTCAE, Labs,
// and collect all data for AI/local summary.

import { ESAS } from './esas.js';
import { CTCAE } from './ctcae.js';
import { Labs } from './labs.js';
import { Utils } from './utils.js';

let Bus, State;

const BIO_FIELDS = [
  'Patient Code',
  'Patient Name',
  'Patient Age',
  'Room',
  'Admitting Provider',
  'Diagnosis',
  'Diet',
  'Isolation',
  'Comments'
];

// حقول نصية طويلة (textarea)
const LONG_FIELDS = {
  'HPI Diagnosis': '#hpi-diagnosis',
  'HPI Initial': '#hpi-initial',
  'HPI Previous': '#hpi-previous',
  'HPI Current': '#hpi-current',
  'Patient Assessment': '#patient-assessment',
  'Medication List': '#medication-list',
  'Latest Notes': '#latest-notes'
};

export const Dashboard = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },

  clearEmpty(showEmpty = true) {
    const panel = document.getElementById('dashboard-panel');
    if (!panel) return;
    panel.dataset.empty = showEmpty ? 'true' : 'false';
  },

  /** يربط المريض باللوحة */
  bindPatient(patient, { esas, ctcae, labs }) {
    this.clearEmpty(false);

    // العنوان
    const titleEl = document.getElementById('dashboard-title');
    if (titleEl) {
      titleEl.textContent = `Dashboard — ${patient['Patient Name'] || patient['Patient Code']}`;
    }

    // تعبئة البايوغرافيا
    const bioGrid = document.getElementById('bio-grid');
    bioGrid.innerHTML = '';
    // تعديل: استبدال تسمية "Diet" بـ "Diagnosis" في واجهة المودال فقط
    // مع ربط الحقل مباشرة بحقل Diagnosis وتجنّب التكرار إن وُجد "Diagnosis" أصلاً.
    const rendered = new Set();
    BIO_FIELDS.forEach(f => {
      const key = (f === 'Diet') ? 'Diagnosis' : f; // التسمية + الربط
      if (rendered.has(key)) return; // لا تكرار لنفس الحقل (مثلاً Diagnosis)
      rendered.add(key);

      const div = document.createElement('div');
      div.className = 'field';

      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = key; // نعرض Diagnosis بدل Diet

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = patient[key] || '';
      inp.setAttribute('data-bind-field', key); // الربط إلى Diagnosis مباشرة

      div.appendChild(label);
      div.appendChild(inp);
      bioGrid.appendChild(div);
    });

    // ربط الحقول النصية الطويلة
    Object.entries(LONG_FIELDS).forEach(([field, selector]) => {
      const el = document.querySelector(selector);
      if (el) {
        el.value = patient[field] || '';
        el.setAttribute('data-bind-field', field);
      }
    });

    // ESAS
    ESAS.render(patient['Patient Code'], esas);

    // CTCAE
    CTCAE.render(patient['Patient Code'], ctcae);

    // Labs
    Labs.render(patient['Patient Code'], labs);
  },

  /** يبني حزمة كاملة لإرسالها إلى AI أو لملخص محلي */
  collectBundleForSummary(patient, { esas, ctcae, labs }) {
    return {
      patient,
      esas,
      ctcae,
      labs
    };
  }
};
