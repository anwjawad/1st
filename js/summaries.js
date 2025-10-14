// js/summaries.js
// قائمة ملخصات المرضى (كل الأقسام) — محلي بالكامل بدون أي API خارجي.
// - يستخدم AIModule.localHeuristicSummary لتوليد نص ملخّص من bundle (patient+esas+ctcae+labs)
// - واجهة: مودال/صفحة فيها تجميع حسب القسم + بحث + نسخ + عرض مختصر/مفصّل + طباعة بسيطة + تقرير طبي احترافي
// - كاش: يعيد توليد ملخّص مريض فقط إذا تغيّر توقيت Updated At (أو حقول أساسية).
//
// [PATCH-5]: إظهار جميع الـ symptoms + symptoms notes في البطاقة والطباعة.
//            لا نعتمد على ai.js لهذا الطلب، بل نضيف مقطعًا ثابتًا في summaries.js.
//
// نقاط الدمج:
// - في app.js: يوجد زر open-summaries موصول مسبقًا.
// - لا نغيّر أي منطق قائم؛ كل التوليد يتم من State الحالي.

import { Utils } from './utils.js';
import { AIModule } from './ai.js';

let Bus, State;

/* =========================
   DOM Helpers
   ========================= */
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function ensureModalScaffold() {
  let modal = document.getElementById('summaries-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'summaries-modal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" style="max-width: 1000px; width: calc(100% - 24px);">
      <div class="modal-header">
        <div class="card-title"><span class="mi md">description</span>&nbsp; All Patient Summaries</div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
          <input id="summaries-search" class="pinput" type="text" placeholder="Search name / code / diagnosis / room…" style="min-width:260px" />
          <label class="checkbox small" title="Show compact preview">
            <input id="summaries-compact" type="checkbox" checked />
            <span>Compact</span>
          </label>
          <div style="width:8px"></div>
          <button id="summaries-collapse-all" class="btn btn-ghost" type="button" title="Collapse all">
            <span class="mi md">unfold_less</span>&nbsp;Collapse All
          </button>
          <button id="summaries-expand-all" class="btn btn-ghost" type="button" title="Expand all">
            <span class="mi md">unfold_more</span>&nbsp;Expand All
          </button>
          <div style="width:8px"></div>
          <button id="summaries-print" class="btn btn-ghost" type="button" title="Quick print">
            <span class="mi md">print</span>&nbsp;Print
          </button>
          <button id="summaries-medical-report" class="btn btn-primary" type="button" title="Medical report PDF">
            <span class="mi md">picture_as_pdf</span>&nbsp;Medical Report PDF
          </button>
          <button class="icon-btn" data-close-modal="summaries-modal" aria-label="Close"><span class="mi md">close</span></button>
        </div>
      </div>
      <div class="modal-body modal-body-pad">
        <div id="summaries-root" class="section" style="display:grid; gap:12px;"></div>
      </div>
      <div class="modal-footer">
        <div class="small muted">Summaries are generated locally from current data. Last refresh: <span id="summaries-refreshed">—</span></div>
        <div style="flex:1"></div>
        <button class="btn btn-primary" data-close-modal="summaries-modal">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

/* =========================
   Cache (per patient)
   ========================= */
const Cache = (() => {
  const map = new Map(); // code -> {version, text, shortText, at}

  function versionFor(p, e, c, l) {
    const pv = p?.['Updated At'] || '';
    const ev = e?.['Updated At'] || '';
    const cv = c?.['Updated At'] || '';
    const lv = l?.['Updated At'] || '';
    const core =
      (p?.['Patient Name']||'') + '|' +
      (p?.['Diagnosis']||'') + '|' +
      (p?.['Room']||'') + '|' +
      (p?.['Patient Assessment']||'') + '|' +
      (p?.['Symptoms']||'') + '|' +                // [PATCH-5] symptoms ضمن النسخة
      (p?.['Symptoms Notes']||'');
    return `${pv}|${ev}|${cv}|${lv}|${core.length}`;
  }

  function get(code, ver) {
    const it = map.get(code);
    if (it && it.version === ver) return it;
    return null;
  }

  function set(code, ver, text, shortText) {
    const at = new Date().toISOString();
    const it = { version: ver, text, shortText, at };
    map.set(code, it);
    return it;
  }

  function invalidate(code) {
    if (code) map.delete(code);
  }

  function clear() { map.clear(); }

  return { versionFor, get, set, invalidate, clear };
})();

/* =========================
   Bundle builder
   ========================= */
function bundleFor(code) {
  const patient = (State.patients || []).find(p => p['Patient Code'] === code) || null;
  if (!patient) return null;
  const esas = (State.esas || []).find(r => r['Patient Code'] === code) || null;
  const ctcae = (State.ctcae || []).find(r => r['Patient Code'] === code) || null;
  const labs = (State.labs || []).find(r => r['Patient Code'] === code) || null;
  return { patient, esas, ctcae, labs };
}

/* =========================
   Symptoms helpers  [PATCH-5]
   ========================= */
function parseSymptomsArray(p) {
  return String(p?.['Symptoms'] || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
function parseSymptomsNotesMap(p) {
  const raw = p?.['Symptoms Notes'] || '{}';
  try { 
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch { /* ignore */ }
  return {};
}
/** نص منسّق لجميع الأعراض + الملاحظات (سطر لكل عَرَض) */
function buildSymptomsBlock(patient) {
  const arr = parseSymptomsArray(patient);
  const notes = parseSymptomsNotesMap(patient);
  if (!arr.length && !Object.keys(notes).length) return ''; // لا شيء
  const lines = arr.length 
    ? arr.map(k => {
        const note = (notes && notes[k]) ? ` — ${String(notes[k]).trim()}` : '';
        return `• ${k}${note}`;
      })
    : Object.keys(notes).map(k => `• ${k} — ${String(notes[k]).trim()}`);
  return lines.join('\n');
}

/* =========================
   Summary generation
   ========================= */
function toShort(text, maxLines = 7) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') + '\n…';
}

/** يبني الملخّص الأساسي من AIModule ثم يضيف symptoms block [PATCH-5] */
function computeFullSummaryWithSymptoms(b) {
  const base = AIModule.localHeuristicSummary(b) || '';
  const symBlock = buildSymptomsBlock(b?.patient);
  if (!symBlock) return base;
  // نضيف قسمًا واضحًا، دون تكرار إذا كان الملخّص الأساسي يتضمنه أصلاً
  if (base.includes('Symptoms:') || base.includes('الأعراض:')) {
    // لو كان موجودًا، نضيف عنوانًا بسيطًا آخر لتجنّب الدمج داخل النص السابق.
    return `${base}\n\nAll Symptoms:\n${symBlock}`;
  }
  return `${base}\n\nSymptoms:\n${symBlock}`;
}

function ensureSummary(code) {
  const b = bundleFor(code);
  if (!b) return { text: '(not found)', shortText: '(not found)' };
  const ver = Cache.versionFor(b.patient, b.esas, b.ctcae, b.labs);
  const cached = Cache.get(code, ver);
  if (cached) return { text: cached.text, shortText: cached.shortText };

  // [PATCH-5] استبدال التوليد المباشر بالتوليد المُحسّن مع الأعراض
  const text = computeFullSummaryWithSymptoms(b);
  const shortText = toShort(text, 7);
  Cache.set(code, ver, text, shortText);
  return { text, shortText };
}

/* =========================
   Rendering
   ========================= */
function groupPatientsBySection(filtered) {
  const bySec = new Map();
  (filtered || []).forEach(p => {
    const sec = p.Section || 'Default';
    if (!bySec.has(sec)) bySec.set(sec, []);
    bySec.get(sec).push(p);
  });
  // sort rooms inside each section (مشابِه app.js)
  const toRoomKey = (v)=>{
    const s = String(v || '').trim();
    if (!s) return {num: Number.POSITIVE_INFINITY, raw: ''};
    const m = s.match(/\d+/);
    const num = m ? parseInt(m[0], 10) : Number.NaN;
    return { num: Number.isNaN(num) ? Number.POSITIVE_INFINITY : num, raw: s.toLowerCase() };
  };
  for (const [sec, arr] of bySec.entries()) {
    arr.sort((a,b)=>{
      const ka = toRoomKey(a.Room);
      const kb = toRoomKey(b.Room);
      if (ka.num !== kb.num) return ka.num - kb.num;
      return ka.raw.localeCompare(kb.raw);
    });
  }
  return bySec;
}

function filterPatients(term) {
  const t = (term || '').toLowerCase().trim();
  const arr = (State.patients || []).slice();
  if (!t) return arr;
  return arr.filter(p => JSON.stringify(p).toLowerCase().includes(t));
}

function makePatientCard(p, compact=true) {
  const code = p['Patient Code'] || '';
  const name = p['Patient Name'] || code || '(Unnamed)';
  const upd  = p['Updated At'] ? Utils.formatDateTime(p['Updated At']) : '—';

  const { text, shortText } = ensureSummary(code);
  const showText = compact ? shortText : text;

  const card = document.createElement('div');
  card.className = 'card';
  card.style.padding = '12px';
  card.style.display = 'grid';
  card.style.gap = '8px';

  const head = document.createElement('div');
  head.className = 'card-head';
  head.style.display = 'flex';
  head.style.justifyContent = 'space-between';
  head.style.alignItems = 'center';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = `${name}`;
  const meta = document.createElement('div');
  meta.className = 'small muted mono';
  meta.textContent = `${p['Room'] ? 'Room '+p['Room']+' • ' : ''}${code} • Updated ${upd}`;

  head.appendChild(title);
  head.appendChild(meta);

  // محتوى الملخص
  const pre = document.createElement('pre');
  pre.className = 'mono small';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.lineHeight = '1.35';
  pre.textContent = showText || '(empty)';

  // [PATCH-5] قسم واضح للأعراض الكاملة + الملاحظات (ظاهريًا أسفل الملخص)
  const symBlock = buildSymptomsBlock(p);
  let symWrap = null;
  if (symBlock) {
    symWrap = document.createElement('div');
    symWrap.className = 'small';
    symWrap.style.background = 'var(--card-2)';
    symWrap.style.border = '1px solid var(--border)';
    symWrap.style.borderRadius = '10px';
    symWrap.style.padding = '8px 10px';
    symWrap.style.whiteSpace = 'pre-wrap';
    symWrap.innerHTML = `<div class="muted" style="margin-bottom:4px;font-weight:600">All Symptoms</div>${symBlock.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`;
  }

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.flexWrap = 'wrap';

  const btnCopy = document.createElement('button');
  btnCopy.className = 'btn btn-ghost';
  btnCopy.type = 'button';
  btnCopy.innerHTML = `<span class="mi md">content_copy</span>&nbsp;Copy`;
  btnCopy.addEventListener('click', async ()=>{
    const ok = await Utils.copyToClipboard(text);
    if (ok) Bus.emit?.('toast', { message: 'Summary copied.', type: 'success' });
  });

  const btnToggle = document.createElement('button');
  btnToggle.className = 'btn';
  btnToggle.type = 'button';
  btnToggle.innerHTML = compact
    ? `<span class="mi md">expand_more</span>&nbsp;Expand`
    : `<span class="mi md">expand_less</span>&nbsp;Collapse`;
  btnToggle.addEventListener('click', ()=>{
    const expanded = btnToggle.innerText.trim().startsWith('Collapse') ? false : true;
    pre.textContent = expanded ? (ensureSummary(code).text || '') : (ensureSummary(code).shortText || '');
    btnToggle.innerHTML = expanded
      ? `<span class="mi md">expand_less</span>&nbsp;Collapse`
      : `<span class="mi md">expand_more</span>&nbsp;Expand`;
  });

  row.appendChild(btnCopy);
  row.appendChild(btnToggle);

  card.appendChild(head);
  card.appendChild(pre);
  if (symWrap) card.appendChild(symWrap); // [PATCH-5]
  card.appendChild(row);
  return card;
}

function renderListRoot(root, searchTerm, compact) {
  root.innerHTML = '';

  const pats = filterPatients(searchTerm);
  const bySec = groupPatientsBySection(pats);
  const sections = Array.from(bySec.keys()).sort((a,b)=> a.localeCompare(b));

  if (!sections.length) {
    const d = document.createElement('div');
    d.className = 'muted small';
    d.textContent = 'No patients match the current search.';
    root.appendChild(d);
    return;
  }

  sections.forEach(sec=>{
    const wrap = document.createElement('div');
    wrap.className = 'card';
    wrap.style.padding = '12px';
    wrap.style.display = 'grid';
    wrap.style.gap = '10px';

    const head = document.createElement('div');
    head.className = 'card-head';
    head.style.display = 'flex';
    head.style.alignItems = 'center';
    head.style.justifyContent = 'space-between';

    const h = document.createElement('div');
    h.className = 'card-title';
    h.textContent = `Section: ${sec}`;

    const tools = document.createElement('div');
    tools.style.display = 'flex';
    tools.style.gap = '8px';

    const btnCollapse = document.createElement('button');
    btnCollapse.className = 'btn btn-ghost';
    btnCollapse.innerHTML = `<span class="mi md">unfold_less</span>&nbsp;Collapse`;

    const btnExpand = document.createElement('button');
    btnExpand.className = 'btn btn-ghost';
    btnExpand.innerHTML = `<span class="mi md">unfold_more</span>&nbsp;Expand`;

    tools.appendChild(btnCollapse);
    tools.appendChild(btnExpand);

    head.appendChild(h);
    head.appendChild(tools);

    wrap.appendChild(head);

    const body = document.createElement('div');
    body.style.display = 'grid';
    body.style.gap = '10px';

    const list = bySec.get(sec) || [];
    list.forEach(p => body.appendChild(makePatientCard(p, compact)));

    btnCollapse.addEventListener('click', ()=>{
      body.innerHTML = '';
      list.forEach(p => body.appendChild(makePatientCard(p, true)));
    });
    btnExpand.addEventListener('click', ()=>{
      body.innerHTML = '';
      list.forEach(p => body.appendChild(makePatientCard(p, false)));
    });

    wrap.appendChild(body);
    root.appendChild(wrap);
  });

  const ref = document.getElementById('summaries-refreshed');
  if (ref) ref.textContent = Utils.formatDateTime(new Date().toISOString());
}

/* =========================
   Printing (Quick + Medical Report)
   ========================= */

function buildQuickPrintHTML(searchTerm = '', compact = true) {
  const pats = filterPatients(searchTerm);
  const bySec = groupPatientsBySection(pats);
  const sections = Array.from(bySec.keys()).sort((a,b)=> a.localeCompare(b));

  const pages = sections.map(sec => {
    const list = bySec.get(sec) || [];
    const rows = list.map(p => {
      const name = p['Patient Name'] || p['Patient Code'] || '(Unnamed)';
      const code = p['Patient Code'] || '';
      const upd  = p['Updated At'] ? Utils.formatDateTime(p['Updated At']) : '—';
      const { text, shortText } = ensureSummary(code);
      const body = compact ? shortText : text;
      const sym  = buildSymptomsBlock(p); // [PATCH-5]
      const esc = s => String(s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const symHTML = sym ? `<div class="small" style="margin-top:6px"><strong>All Symptoms</strong><br/><pre class="mono small" style="white-space:pre-wrap; border:1px solid #ddd; padding:6px; border-radius:8px; background:#fafafa">${esc(sym)}</pre></div>` : '';
      return `
        <div style="break-inside:avoid; margin:0 0 10px 0; padding:10px; border:1px solid var(--border); border-radius:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-weight:700;">${esc(name)}</div>
            <div class="mono small muted">${esc(code)} • Updated ${esc(upd)}</div>
          </div>
          <pre class="mono small" style="white-space:pre-wrap; line-height:1.3;">${esc(body)}</pre>
          ${symHTML}
        </div>`;
    }).join('\n');

    return `
      <div class="print-page">
        <div class="print-head" style="margin-bottom:6px;">
          <div class="print-title">Patient Summaries — Section: ${sec}</div>
          <div class="print-sub">Generated: ${Utils.formatDateTime(new Date().toISOString())}</div>
        </div>
        ${rows || '<div class="small muted">No patients</div>'}
      </div>`;
  }).join('\n');

  return pages;
}

function buildMedicalReportHTML(searchTerm = '', compact = false, options = {}) {
  const { grouped = true, includeCover = true } = options || {};
  const pats = filterPatients(searchTerm);

  const bySec = grouped ? groupPatientsBySection(pats) : new Map([['All', pats]]);
  const sections = Array.from(bySec.keys()).sort((a,b)=> a.localeCompare(b));

  const esc = s => String(s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  const pages = sections.map(sec => {
    const list = bySec.get(sec) || [];

    const cover = includeCover ? `
      <div class="print-page" style="display:flex; align-items:center; justify-content:center;">
        <div style="text-align:center">
          <div style="font-size:24px; font-weight:800; letter-spacing:.5px; margin-bottom:6px">Patient Medical Report</div>
          <div style="font-size:15px; opacity:.8">Section: ${esc(sec)}</div>
          <div style="margin-top:14px" class="mono small muted">${esc(Utils.formatDateTime(new Date().toISOString()))}</div>
        </div>
      </div>
    ` : '';

    const blocks = list.map(p => {
      const code = p['Patient Code'] || '';
      const name = p['Patient Name'] || code || '(Unnamed)';
      const age  = p['Patient Age'] || '';
      const room = p['Room'] || '';
      const prov = p['Admitting Provider'] || '';
      const upd  = p['Updated At'] ? Utils.formatDateTime(p['Updated At']) : '—';
      const { text, shortText } = ensureSummary(code);
      const body = compact ? shortText : text;
      const symptomsFull = buildSymptomsBlock(p); // [PATCH-5]

      const infoTable = `
        <table style="width:100%; border-collapse:collapse; font-size:12px">
          <tr><td style="width:22%; border:1px solid #ddd; padding:6px"><strong>Name</strong></td><td style="border:1px solid #ddd; padding:6px">${esc(name)}</td></tr>
          <tr><td style="border:1px solid #ddd; padding:6px"><strong>Code</strong></td><td style="border:1px solid #ddd; padding:6px" class="mono">${esc(code)}</td></tr>
          <tr><td style="border:1px solid #ddd; padding:6px"><strong>Age</strong></td><td style="border:1px solid #ddd; padding:6px">${esc(age)}</td></tr>
          <tr><td style="border:1px solid #ddd; padding:6px"><strong>Room</strong></td><td style="border:1px solid #ddd; padding:6px">${esc(room)}</td></tr>
          <tr><td style="border:1px solid #ddd; padding:6px"><strong>Admitting Provider</strong></td><td style="border:1px solid #ddd; padding:6px">${esc(prov)}</td></tr>
          <tr><td style="border:1px solid #ddd; padding:6px"><strong>Updated</strong></td><td style="border:1px solid #ddd; padding:6px">${esc(upd)}</td></tr>
        </table>`;

      const summaryBox = `
        <div style="margin-top:10px">
          <div style="font-weight:700; margin:6px 0">Summary</div>
          <pre class="mono small" style="white-space:pre-wrap; line-height:1.35; border:1px solid #ddd; padding:8px; border-radius:8px; background:#fafafa">${esc(body)}</pre>
        </div>`;

      const symptomsBox = symptomsFull ? `
        <div style="margin-top:8px">
          <div style="font-weight:700; margin:6px 0">All Symptoms</div>
          <pre class="mono small" style="white-space:pre-wrap; line-height:1.35; border:1px solid #ddd; padding:8px; border-radius:8px; background:#fafafa">${esc(symptomsFull)}</pre>
        </div>` : '';

      return `
        <div style="break-inside:avoid; margin:0 0 14px 0; padding:12px; border:1px solid #ddd; border-radius:10px;">
          ${infoTable}
          ${summaryBox}
          ${symptomsBox}
        </div>`;
    }).join('\n');

    return `${cover}
      <div class="print-page">
        <div class="print-head" style="margin-bottom:10px;">
          <div class="print-title">Section: ${esc(sec)}</div>
          <div class="print-sub">Generated: ${Utils.formatDateTime(new Date().toISOString())}</div>
        </div>
        ${blocks || '<div class="small muted">No patients</div>'}
      </div>`;
  }).join('\n');

  return pages;
}

/* =========================
   Public API (Modal open)
   ========================= */
function openModal() {
  const modal = ensureModalScaffold();
  const root = document.getElementById('summaries-root');
  const search = document.getElementById('summaries-search');
  const compactCb = document.getElementById('summaries-compact');
  const btnCollapse = document.getElementById('summaries-collapse-all');
  const btnExpand   = document.getElementById('summaries-expand-all');
  const btnPrint    = document.getElementById('summaries-print');
  const btnReport   = document.getElementById('summaries-medical-report');

  const render = () => renderListRoot(root, search?.value || '', !!compactCb?.checked);

  search?.addEventListener('input', Utils.debounce(render, 180));
  compactCb?.addEventListener('change', render);
  btnCollapse?.addEventListener('click', ()=> {
    // اجبر إعادة بناء كل البطاقات بوضع compact=true
    renderListRoot(root, search?.value || '', true);
  });
  btnExpand?.addEventListener('click', ()=> {
    renderListRoot(root, search?.value || '', false);
  });

  btnPrint?.addEventListener('click', ()=> {
    const html = buildQuickPrintHTML(search?.value || '', !!compactCb?.checked);
    const printRoot = document.getElementById('print-root') || (()=>{ const d=document.createElement('div'); d.id='print-root'; document.body.appendChild(d); return d; })();
    printRoot.innerHTML = html;
    printRoot.style.display = '';
    document.body.setAttribute('data-printing','true');
    window.print();
    setTimeout(()=>{ document.body.removeAttribute('data-printing'); printRoot.style.display='none'; }, 400);
  });

  btnReport?.addEventListener('click', ()=> {
    const html = buildMedicalReportHTML(search?.value || '', false, { grouped: true, includeCover: true });
    const printRoot = document.getElementById('print-root') || (()=>{ const d=document.createElement('div'); d.id='print-root'; document.body.appendChild(d); return d; })();
    printRoot.innerHTML = html;
    printRoot.style.display = '';
    document.body.setAttribute('data-printing','true');
    window.print();
    setTimeout(()=>{ document.body.removeAttribute('data-printing'); printRoot.style.display='none'; }, 400);
  });

  render();
  modal.classList.remove('hidden');
  document.documentElement.style.overflow='hidden';

  // إغلاق من زر X أو الكليك على الخلفية
  modal.addEventListener('click', (e)=>{
    if (e.target.closest('[data-close-modal="summaries-modal"]') || e.target === modal) {
      modal.classList.add('hidden');
      document.documentElement.style.overflow='';
    }
  }, { once: true });
}

/* =========================
   Module export
   ========================= */
export const Summaries = {
  init(bus, state) {
    Bus = bus;
    State = state;
  },
  open() {
    openModal();
  }
};