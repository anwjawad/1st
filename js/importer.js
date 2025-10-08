// js/importer.js
// Robust CSV/TSV/PDF→CSV Importer
// - PRIORITY: Custom template that ignores empty/Unnamed columns comes FIRST
// - Accepts NEW template (13 cols), LEGACY template (9 cols), or CUSTOM merged Excel export
// - Legacy maps “Cause Of Admission” -> Diagnosis
// - Case/whitespace tolerant; handles BOM; delimiter auto-detect (, ; \t)
// - Always returns rows aligned to EXPECTED_HEADERS so app.js can build objects reliably
// - Preview is scrollable via container CSS (white-space: nowrap)

import { UI } from './ui.js';

let Bus, State;

const EXPECTED_HEADERS = [
  'Patient Code',
  'Patient Name',
  'Patient Age',
  'Room',
  'Diagnosis',
  'Section',
  'Admitting Provider',
  'Diet',
  'Isolation',
  'Comments',
  'Symptoms (comma-separated)',
  'Symptoms Notes (JSON map)',
  'Labs Abnormal (comma-separated)'
];

// Legacy headers (order as provided)
const LEGACY_HEADERS = [
  'Patient Code',
  'Patient Name',
  'Patient Age',
  'Room',
  'Admitting Provider',
  'Cause Of Admission',
  'Diet',
  'Isolation',
  'Comments'
];

const els = {
  modal: () => document.getElementById('import-modal'),
  file: () => document.getElementById('csv-file-input'),
  preview: () => document.getElementById('csv-preview')
};

let validatedRows = [];
let lastMode = 'new'; // 'new' | 'legacy' | custom-name

// ===== Helpers =====
function stripBOM(s){ return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s; }
function norm(s){ return String(s ?? '').replace(/\u00A0/g,' ').trim(); } // trim & nbsp
function eqCase(a,b){ return norm(a).toLowerCase() === norm(b).toLowerCase(); }

// Auto-detect delimiter from first line
function detectDelimiter(text) {
  const first = ((text || '').split(/\r?\n/, 1)[0] || '');
  const counts = {
    ',': (first.match(/,/g) || []).length,
    '\t': (first.match(/\t/g) || []).length,
    ';': (first.match(/;/g) || []).length
  };
  let best = ',', max = -1;
  for (const d of [',','\t',';']) {
    if (counts[d] > max) { max = counts[d]; best = d; }
  }
  return best;
}

// Basic DSV parser with quotes
function parseDSV(text, delim) {
  const rows = [];
  let i = 0, f = '', row = [], inQ = false;
  const D = (delim === '\t') ? '\t' : delim;

  const pushField = () => { row.push(f); f = ''; };
  const pushRow = () => { rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i+1] === '"') { f += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      } else { f += ch; i++; continue; }
    } else {
      if (ch === '"') { inQ = true; i++; continue; }
      if (ch === D) { pushField(); i++; continue; }
      if (ch === '\n') { pushField(); pushRow(); i++; continue; }
      if (ch === '\r') {
        pushField(); pushRow();
        if (text[i+1] === '\n') i += 2; else i += 1;
        continue;
      }
      f += ch; i++;
    }
  }
  pushField();
  if (row.length>1 || (row.length===1 && row[0] !== '')) pushRow();
  return rows;
}

// Extract first integer from an age string -> '72 Years 4 Months' -> '72'
function extractAgeNumber(val){
  const s = (val == null ? '' : String(val)).trim();
  const m = s.match(/\b(\d{1,3})\b/);
  return m ? m[1] : (s && /^\d+$/.test(s) ? s : '');
}

// Validate/recognize header
function validateHeaders(gotHeaderRaw) {
  const got = (gotHeaderRaw || []).map((h,i)=> i===0 ? norm(stripBOM(h)) : norm(h));

  // Exact NEW?
  if (got.length === EXPECTED_HEADERS.length && EXPECTED_HEADERS.every((h,i)=> eqCase(h, got[i]))) {
    return { ok: true, mode: 'new', message: 'Detected NEW template.' };
  }

  // Exact LEGACY?
  if (got.length === LEGACY_HEADERS.length && LEGACY_HEADERS.every((h,i)=> eqCase(h, got[i]))) {
    return { ok: true, mode: 'legacy', message: 'Detected LEGACY template. Mapping “Cause Of Admission” → “Diagnosis”.' };
  }

  // Relaxed legacy
  const gotLower = got.map(x=>x.toLowerCase());
  const legacyLower = LEGACY_HEADERS.map(x=>x.toLowerCase());
  const isLegacyRelaxed = got.length===LEGACY_HEADERS.length && gotLower.every((x,i)=> x===legacyLower[i]);
  if (isLegacyRelaxed) {
    return { ok: true, mode: 'legacy', message: 'Detected LEGACY template (relaxed). Mapping “Cause Of Admission” → “Diagnosis”.' };
  }

  return {
    ok: false,
    error: `Header mismatch. Expected either:
- NEW: ${EXPECTED_HEADERS.join(' | ')}
- LEGACY: ${LEGACY_HEADERS.join(' | ')}
Got: ${got.join(' | ')}`
  };
}

function normalizeRowLength(row, targetLen) {
  const out = new Array(targetLen).fill('');
  for (let i=0; i<Math.min(row.length, targetLen); i++) out[i] = (row[i] ?? '').toString();
  return out;
}

// Map legacy row (9 cols) -> expected (13 cols)
function mapLegacyRowToExpected(row9) {
  const r = normalizeRowLength(row9, LEGACY_HEADERS.length);
  const out = new Array(EXPECTED_HEADERS.length).fill('');
  out[0]  = r[0] || ''; // Patient Code
  out[1]  = r[1] || ''; // Patient Name
  out[2]  = extractAgeNumber(r[2]); // Patient Age (numeric only)
  out[3]  = r[3] || ''; // Room
  out[4]  = r[5] || ''; // Diagnosis <= Cause Of Admission
  out[5]  = '';         // Section (filled with active section in app.js)
  out[6]  = r[4] || ''; // Admitting Provider
  out[7]  = r[6] || ''; // Diet
  out[8]  = r[7] || ''; // Isolation
  out[9]  = r[8] || ''; // Comments
  out[10] = '';         // Symptoms
  out[11] = '';         // Symptoms Notes
  out[12] = '';         // Labs Abnormal
  return out;
}

/* =========================
   CUSTOM TEMPLATE REGISTRY
   (Highest priority; ignores Unnamed/empty columns)
   ========================= */

const CUSTOM_TEMPLATES = [

  // PRIMARY: your main template with empty/Unnamed columns ignored (highest priority)
  {
    name: 'MAIN_TEMPLATE_EMPTY_COLS',
    recognize: (gotHeaderRaw) => {
      const got = (gotHeaderRaw || []).map(h => (h ?? '').toString().trim());
      // Filter out empty / unnamed headers
      const base = got.filter(h => h && !/^unnamed[:\s]*/i.test(h));
      const low = base.map(h => h.toLowerCase());
      const need = [
        'patient code',
        'patient name',
        'patient age',
        'room',
        'admitting provider',
        'cause of admission',
        'diet',
        'isolation',
        'comments'
      ];
      return need.every(n => low.includes(n));
    },
    mapRow: (row, headerRaw) => {
      const H = (headerRaw || []).map(h => (h ?? '').toString().trim());
      const Hl = H.map(h => h.toLowerCase());

      // find first matching non-empty header cell (ignore unnamed/empty)
      function idxFor(keyLow){
        for (let i=0;i<Hl.length;i++){
          if (!Hl[i]) continue;
          if (/^unnamed[:\s]*/.test(Hl[i])) continue;
          if (Hl[i] === keyLow) return i;
        }
        return -1;
      }

      const iCode = idxFor('patient code');
      const iName = idxFor('patient name');
      const iAge  = idxFor('patient age');
      const iRoom = idxFor('room');
      const iProv = idxFor('admitting provider');
      const iDiag = idxFor('cause of admission');
      const iDiet = idxFor('diet');
      const iIso  = idxFor('isolation');
      const iComm = idxFor('comments');

      const v = (i) => (i>=0 ? (row[i] ?? '') : '');

      const vCode = v(iCode);
      const vName = v(iName);
      const vAge  = extractAgeNumber(v(iAge));
      const vRoom = v(iRoom);
      const vProv = v(iProv);
      const vDiag = v(iDiag); // -> Diagnosis
      const vDiet = v(iDiet);
      const vIso  = v(iIso);
      const vComm = v(iComm);

      return [
        vCode,  // Patient Code
        vName,  // Patient Name
        vAge,   // Patient Age (numeric only)
        vRoom,  // Room
        vDiag,  // Diagnosis
        '',     // Section -> filled later (active section)
        vProv,  // Admitting Provider
        vDiet,  // Diet
        vIso,   // Isolation
        vComm,  // Comments
        '',     // Symptoms
        '',     // Symptoms Notes
        ''      // Labs Abnormal
      ];
    }
  },

  // Secondary: Excel merged with contiguous Unnamed: columns (still custom)
  {
    name: 'EXCEL_MERGED_WITH_UNNAMED',
    recognize: (gotHeaderRaw) => {
      const got = (gotHeaderRaw || []).map(h => (h ?? '').toString().trim());
      const low = got.map(h => h.toLowerCase());
      const base = low.filter(h => !/^unnamed:/.test(h));
      const need = [
        'patient code',
        'patient name',
        'patient age',
        'room',
        'admitting provider',
        'cause of admission',
        'diet',
        'isolation',
        'comments'
      ];
      return need.every(n => base.includes(n));
    },
    mapRow: (row, headerRaw) => {
      const H = (headerRaw || []).map(h => (h ?? '').toString().trim());
      const Hl = H.map(h => h.toLowerCase());

      function idxsFor(keyLow) {
        const idxs = [];
        for (let i = 0; i < Hl.length; i++) {
          if (Hl[i] === keyLow) {
            idxs.push(i);
            // attach contiguous Unnamed: columns
            let j = i + 1;
            while (j < Hl.length && /^unnamed:/.test(Hl[j])) {
              idxs.push(j);
              j++;
            }
          }
        }
        return idxs.length ? idxs : [-1];
      }

      function pickFirstNonEmpty(indexes) {
        for (const idx of indexes) {
          const v = (idx >= 0 ? row[idx] : '');
          const s = (v == null ? '' : String(v)).trim();
          if (s) return s;
        }
        return '';
      }

      const vCode = pickFirstNonEmpty(idxsFor('patient code'));
      const vName = pickFirstNonEmpty(idxsFor('patient name'));
      const vAgeRaw = pickFirstNonEmpty(idxsFor('patient age'));
      const vAge = extractAgeNumber(vAgeRaw);
      const vRoom = pickFirstNonEmpty(idxsFor('room'));
      const vProv = pickFirstNonEmpty(idxsFor('admitting provider'));
      const vDiag = pickFirstNonEmpty(idxsFor('cause of admission')); // -> Diagnosis
      const vDiet = pickFirstNonEmpty(idxsFor('diet'));
      const vIso  = pickFirstNonEmpty(idxsFor('isolation'));
      const vComm = pickFirstNonEmpty(idxsFor('comments'));

      return [
        vCode,  // Patient Code
        vName,  // Patient Name
        vAge,   // Patient Age (numeric only)
        vRoom,  // Room
        vDiag,  // Diagnosis
        '',     // Section → filled later in app.js
        vProv,  // Admitting Provider
        vDiet,  // Diet
        vIso,   // Isolation
        vComm,  // Comments
        '',     // Symptoms (comma-separated)
        '',     // Symptoms Notes (JSON map)
        ''      // Labs Abnormal (comma-separated)
      ];
    }
  }
];

/* =========================
   PREVIEW
   ========================= */

function renderPreview(rows, mode) {
  const root = els.preview(); root.innerHTML='';
  const wrap = document.createElement('div');
  wrap.style.maxHeight = '60vh';
  wrap.style.overflow = 'auto';
  wrap.style.border = '1px solid var(--border)';
  wrap.style.borderRadius = '12px';

  const table = document.createElement('table');
  table.className='mono small';
  table.style.borderCollapse='collapse';
  table.style.whiteSpace='nowrap';
  table.style.width='100%';

  const maxRows = Math.min(rows.length, 11);
  for (let r=0; r<maxRows; r++){
    const tr = document.createElement('tr');
    rows[r].forEach(cell=>{
      const td = document.createElement(r===0?'th':'td');
      td.textContent = cell ?? '';
      td.style.border='1px solid var(--border)';
      td.style.padding='4px 6px';
      td.style.textAlign='left';
      if (r===0){ td.style.background='rgba(124,156,255,.10)'; td.style.fontWeight='700'; td.style.position='sticky'; td.style.top='0'; }
      tr.appendChild(td);
    });
    table.appendChild(tr);
  }

  wrap.appendChild(table);
  root.appendChild(wrap);

  const note = document.createElement('div');
  note.className='small muted';
  note.style.marginTop='6px';
  if (rows.length>11) note.textContent = `Showing first 10 rows (${rows.length-1} total). Mode: ${String(mode||'').toUpperCase()}.`;
  else if (rows.length<=1) note.textContent = `No data rows detected. Mode: ${String(mode||'').toUpperCase()}.`;
  else note.textContent = `${rows.length-1} data rows. Mode: ${String(mode||'').toUpperCase()}.`;
  root.appendChild(note);
}

/* =========================
   MAIN HANDLER
   ========================= */

async function handleFileChange() {
  const file = els.file()?.files?.[0];
  if (!file) return;

  try{
    const textRaw = await file.text();
    const text = stripBOM(textRaw);
    const delim = detectDelimiter(text);
    const rows = parseDSV(text, delim);
    if (!rows.length){
      validatedRows=[]; els.preview().innerHTML='<div class="muted small">Empty file.</div>'; return;
    }

    // Normalize header
    rows[0][0] = stripBOM(rows[0][0]||'');
    const header = rows[0].map(h=> norm(h));

    // =======================================================
    // 1) Try CUSTOM templates FIRST (highest priority)
    // =======================================================
    const custom = CUSTOM_TEMPLATES.find(tpl => tpl.recognize(rows[0]));
    if (custom){
      const dataRows = rows.slice(1).filter(r => r.some(c => norm(c) !== ''));
      const normalized = dataRows.map(r => custom.mapRow(r, rows[0]));
      validatedRows = normalized;
      lastMode = custom.name.toLowerCase();
      renderPreview([EXPECTED_HEADERS, ...validatedRows.slice(0,10)], custom.name);
      UI.toast(`Detected custom template: ${custom.name}. ${validatedRows.length} rows ready.`, 'success');
      return;
    }

    // =======================================================
    // 2) Then NEW/LEGACY templates
    // =======================================================
    const chk = validateHeaders(header);
    if (chk.ok){
      const dataRows = rows.slice(1).filter(r=> r.some(c=> norm(c) !== '') );
      let normalized = [];
      if (chk.mode === 'new'){
        normalized = dataRows.map(r => {
          const out = normalizeRowLength(r, EXPECTED_HEADERS.length);
          // Force age to numeric only
          out[2] = extractAgeNumber(out[2]);
          return out;
        });
      } else {
        normalized = dataRows.map(r => mapLegacyRowToExpected(r));
      }

      validatedRows = normalized;
      lastMode = chk.mode;
      renderPreview([EXPECTED_HEADERS, ...validatedRows.slice(0,10)], chk.mode);

      const msg = chk.mode==='legacy'
        ? 'Legacy template detected. “Cause Of Admission” will be stored under “Diagnosis”.'
        : 'Validated NEW template.';
      UI.toast(`${msg} ${validatedRows.length} rows ready.`, 'success');
      return;
    }

    // 3) If nothing matched
    validatedRows=[]; els.preview().innerHTML = `<div class="toast danger" style="white-space:pre-wrap">${chk.error}</div>`;
    UI.toast('Invalid headers. Please match NEW, LEGACY, or the supported custom template.','danger');

  }catch(err){
    console.error(err);
    validatedRows=[]; els.preview().innerHTML = `<div class="toast danger">Failed to read/parse file.</div>`;
    UI.toast('Failed to read/parse file.','danger');
  }
}

/* =========================
   PUBLIC API
   ========================= */

export const Importer = {
  init(bus, state){
    Bus=bus; State=state;
    els.file()?.addEventListener('change', handleFileChange);
  },
  open(){
    validatedRows=[]; els.file().value=''; els.preview().innerHTML='';
    els.modal()?.classList.remove('hidden');
  },
  close(){ els.modal()?.classList.add('hidden'); },
  consumeValidatedRows(){
    return validatedRows.map(r=>[...r]);
  }
};
