// js/importer.js
// Robust CSV/TSV Importer
// - Accepts NEW template (13 cols) or LEGACY template (9 cols)
// - Legacy maps “Cause Of Admission” -> Diagnosis
// - Case/whitespace tolerant; handles BOM; delimiter auto-detect (, ; \t)
// - Always returns rows aligned to EXPECTED_HEADERS so app.js can build objects reliably
// - Scrollable preview is handled by container CSS in index/styles (white-space: nowrap)

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
let lastMode = 'new'; // 'new' | 'legacy'

// ===== Helpers =====
function stripBOM(s){ return (s && s.charCodeAt(0) === 0xFEFF) ? s.slice(1) : s; }
function norm(s){ return String(s ?? '').replace(/\u00A0/g,' ').trim(); } // trim & nbsp
function eqCase(a,b){ return norm(a).toLowerCase() === norm(b).toLowerCase(); }

function detectDelimiter(text) {
  const first = (text.split(/\r?\n/, 1)[0] || '');
  const counts = {
    ',': (first.match(/,/g)||[]).length,
    '\t': (first.match(/\t/g)||[]).length,
    ';': (first.match(/;/g)||[]).length
  };
  let best = ',', max = -1;
  for (const d in counts){ if (counts[d] > max){ max = counts[d]; best = d; } }
  return best;
}

// Basic DSV parser with quotes
function parseDSV(text, delim) {
  const rows = [];
  let i=0, f='', row=[], inQ=false;
  const pushField=()=>{ row.push(f); f=''; };
  const pushRow=()=>{ rows.push(row); row=[]; };

  while (i<text.length){
    const ch = text[i];
    if (inQ){
      if (ch === '"'){
        if (text[i+1] === '"'){ f+='"'; i+=2; continue; }
        inQ=false; i++; continue;
      } else { f+=ch; i++; continue; }
    } else {
      if (ch === '"'){ inQ=true; i++; continue; }
      if (ch === delim){ pushField(); i++; continue; }
      if (ch === '\n'){ pushField(); pushRow(); i++; continue; }
      if (ch === '\r'){ i++; continue; }
      f += ch; i++;
    }
  }
  pushField();
  if (row.length>1 || (row.length===1 && row[0] !== '')) pushRow();
  return rows;
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

  // Try relaxed legacy recognition by set equality (just in case extra spaces/case)
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
  out[2]  = r[2] || ''; // Patient Age
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
  if (rows.length>11) note.textContent = `Showing first 10 rows (${rows.length-1} total). Mode: ${mode.toUpperCase()}.`;
  else if (rows.length<=1) note.textContent = `No data rows detected. Mode: ${mode.toUpperCase()}.`;
  else note.textContent = `${rows.length-1} data rows. Mode: ${mode.toUpperCase()}.`;
  root.appendChild(note);
}

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

    const chk = validateHeaders(header);
    if (!chk.ok){
      validatedRows=[]; els.preview().innerHTML = `<div class="toast danger" style="white-space:pre-wrap">${chk.error}</div>`;
      UI.toast('Invalid headers. Please match NEW or LEGACY template.','danger'); return;
    }

    const dataRows = rows.slice(1).filter(r=> r.some(c=> norm(c) !== '') );

    let normalized = [];
    if (chk.mode === 'new'){
      normalized = dataRows.map(r => normalizeRowLength(r, EXPECTED_HEADERS.length));
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

  }catch(err){
    console.error(err);
    validatedRows=[]; els.preview().innerHTML = `<div class="toast danger">Failed to read/parse file.</div>`;
    UI.toast('Failed to read/parse file.','danger');
  }
}

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
