// js/ai.js
// AI Summary module: local heuristic summary + optional remote proxy call.
// The UI stays English. Comments are Arabic for maintainers.

import { Utils } from './utils.js';

let Bus, State;

// مراجع المختبرات نفسها المستخدمة في labs.js لتحديد الشاذ (تكرار مقصود لتوليد الملخص دون الاعتماد على DOM)
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
};

function parseNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

function classifyLab(name, raw) {
  const ref = REF[name];
  if (!ref) return { status: 'normal', parsed: null, ref: null };
  const n = parseNumber(raw);
  if (n === null) return { status: 'normal', parsed: null, ref };
  if (n < ref[0]) return { status: 'low', parsed: n, ref };
  if (n > ref[1]) return { status: 'high', parsed: n, ref };
  return { status: 'normal', parsed: n, ref };
}

// يبني ملخصًا نصيًا من الحزمة
function buildLocalSummary(bundle) {
  const { patient, esas, ctcae, labs } = bundle || {};
  if (!patient) return 'No patient selected.';

  const name = patient['Patient Name'] || patient['Patient Code'] || 'Unknown';
  const age = patient['Patient Age'] ? `${patient['Patient Age']} yrs` : '—';
  const room = patient['Room'] || '—';
  const provider = patient['Admitting Provider'] || '—';
  const dx = patient['Diagnosis'] || '—';
  const diet = patient['Diet'] || '—';
  const iso = patient['Isolation'] || '—';
  const comments = patient['Comments'] || '';

  // HPI / نصوص
  const hpiDiag = patient['HPI Diagnosis'] || '';
  const hpiInitial = patient['HPI Initial'] || '';
  const hpiPrev = patient['HPI Previous'] || '';
  const hpiCurrent = patient['HPI Current'] || '';
  const assessment = patient['Patient Assessment'] || '';
  const meds = patient['Medication List'] || '';
  const notes = patient['Latest Notes'] || '';

  // ESAS: التقط الدرجات المحددة فقط
  const esasLines = [];
  const ESAS_FIELDS = [
    'Pain', 'Tiredness', 'Drowsiness', 'Nausea', 'Lack of Appetite',
    'Shortness of Breath', 'Depression', 'Anxiety', 'Wellbeing'
  ];
  if (esas) {
    ESAS_FIELDS.forEach(f => {
      const v = esas[f];
      if (v !== '' && v !== null && v !== undefined) {
        const note = esas[`${f} Note`] ? ` (${esas[`${f} Note`]})` : '';
        esasLines.push(`${f}: ${v}${note}`);
      }
    });
  }

  // CTCAE: إذا مفعّل، استخرج الدرجات المحددة
  const ctcaeLines = [];
  const CTCAE_FIELDS = [
    'Fatigue','Sleep','Nausea','Vomiting','Constipation','Diarrhea',
    'Dyspnea','Odynophagia','Dysphagia','Confusion/Delirium',
    'Peripheral Neuropathy','Mucositis'
  ];
  const ctcaeEnabled = !!(ctcae && String(ctcae['Enabled']).toLowerCase() === 'true');
  if (ctcae && ctcaeEnabled) {
    CTCAE_FIELDS.forEach(f => {
      const v = ctcae[f];
      if (v !== '' && v !== null && v !== undefined) {
        const note = ctcae[`${f} Note`] ? ` (${ctcae[`${f} Note`]})` : '';
        ctcaeLines.push(`${f}: ${v}${note}`);
      }
    });
    if (ctcae['Other']) ctcaeLines.push(`Other: ${ctcae['Other']}`);
  }

  // Labs: استخرج الشاذ (مرتفع/منخفض) + Other دائمًا
  const labHigh = [];
  const labLow = [];
  if (labs) {
    Object.keys(REF).forEach(k => {
      const raw = labs[k];
      const c = classifyLab(k, raw);
      if (c.status === 'high') labHigh.push(`${k}: ${raw} ↑`);
      if (c.status === 'low') labLow.push(`${k}: ${raw} ↓`);
    });
  }
  const labsOther = labs?.['Other'] ? `Other: ${labs['Other']}` : '';

  // بناء النص النهائي (منسّق بشكل مبسّط وواضح)
  const parts = [];

  parts.push(
    `Patient: ${name} — Age: ${age}, Room: ${room}`,
    `Admitting Provider: ${provider}`,
    `Diagnosis: ${dx}`,
    `Diet: ${diet} | Isolation: ${iso}`,
    comments ? `Comments: ${comments}` : null
  );

  // HPI & Clinical narrative
  const hpiSection = [];
  if (hpiDiag) hpiSection.push(`HPI Diagnosis: ${hpiDiag}`);
  if (hpiInitial) hpiSection.push(`Initial: ${hpiInitial}`);
  if (hpiPrev) hpiSection.push(`Previous: ${hpiPrev}`);
  if (hpiCurrent) hpiSection.push(`Current: ${hpiCurrent}`);
  if (hpiSection.length) parts.push('', 'HPI:', ...hpiSection);

  if (assessment) parts.push('', `Assessment: ${assessment}`);
  if (meds) parts.push('', `Medications: ${meds}`);
  if (notes) parts.push('', `Latest Notes: ${notes}`);

  if (esasLines.length) {
    parts.push('', 'ESAS (0–10):', ...esasLines.map(s => '• ' + s));
  }

  if (ctcaeEnabled && ctcaeLines.length) {
    parts.push('', 'CTCAE (0–4):', ...ctcaeLines.map(s => '• ' + s));
  } else if (ctcae && !ctcaeEnabled) {
    parts.push('', 'CTCAE: disabled');
  }

  if (labHigh.length || labLow.length || labsOther) {
    parts.push('', 'Labs:');
    if (labHigh.length) parts.push('High:', ...labHigh.map(s => '• ' + s));
    if (labLow.length) parts.push('Low:', ...labLow.map(s => '• ' + s));
    if (labsOther) parts.push(labsOther);
  }

  // ختم بسيط
  const updated = patient['Updated At'] ? Utils.formatDateTime(patient['Updated At']) : '—';
  parts.push('', `Last Updated: ${updated}`);

  return parts.filter(Boolean).join('\n');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  return await Promise.race([
    fetch(url, options),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Request timed out')), timeoutMs))
  ]);
}

export const AIModule = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },

  /** ملخص محلي بسيط (لا يحتاج إنترنت) */
  localHeuristicSummary(bundle) {
    return buildLocalSummary(bundle);
  },

  /**
   * ملخص عبر Proxy خارجي تتحكم به:
   * - endpoint: عنوان HTTPS لديك يستقبل JSON: { bundle }
   * - يجب أن يعيد { summary: string } أو نصًا خامًا
   * ملاحظة: لا ترسل مفاتيح من الواجهة؛ الـ endpoint لديك يتكفّل بمناداة مزوّد الـ AI.
   */
  async remoteSummarize(endpoint, bundle) {
    if (!endpoint) throw new Error('Missing AI proxy endpoint.');
    const res = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle })
    }, 25000);

    if (!res.ok) throw new Error(`AI proxy HTTP ${res.status}`);
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
      const summary = data?.summary || data?.result || data?.text;
      if (!summary) throw new Error('AI proxy: no summary field.');
      return String(summary);
    } else {
      // نص خام
      const text = await res.text();
      return text?.trim() || '(empty AI response)';
    }
  }
};