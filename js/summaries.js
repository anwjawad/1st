// js/summaries.js
// قائمة ملخصات المرضى (كل الأقسام) — محلي بالكامل بدون أي API خارجي.
// - يستخدم AIModule.localHeuristicSummary لتوليد نص ملخّص من bundle (patient+esas+ctcae+labs)
// - واجهة: مودال/صفحة فيها تجميع حسب القسم + بحث + نسخ + عرض مختصر/مفصّل + طباعة
// - كاش: يعيد توليد ملخّص مريض فقط إذا تغيّر توقيت Updated At (أو حقول أساسية).
//
// المتطلبات في index.html (سنضيفها لاحقًا):
// <button id="open-summaries">All Summaries</button>
// <div id="summaries-modal" class="modal hidden">… (سيُبنى تلقائيًا إن لم يوجد)
// أو يمكن عرضه كلوحة مستقلة بدلاً من مودال عبر renderStandalone().
//
// نقاط الدمج:
// - في app.js: Summaries.init(Bus, State) + زر لفتح Summaries.open()
// - لا نغيّر أي منطق قائم؛ كل التوليد يتم من State الحالي

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
        <div style="display:flex; gap:8px; align-items:center;">
          <input id="summaries-search" class="pinput" type="text" placeholder="Search name / code / diagnosis / room…" style="min-width:260px" />
          <label class="checkbox small" title="Show compact preview">
            <input id="summaries-compact" type="checkbox" checked />
            <span>Compact</span>
          </label>
          <button id="summaries-print" class="btn btn-ghost" type="button" title="Print all summaries"><span class="mi md">print</span>&nbsp;Print</button>
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
    // نعتمد على Updated At الأساسية إن توفرت؛ وإلاّ نبني بصمة مبسطة
    const pv = p?.['Updated At'] || '';
    const ev = e?.['Updated At'] || '';
    const cv = c?.['Updated At'] || '';
    const lv = l?.['Updated At'] || '';
    // بعض الحقول الأساسية قد تتغير بدون Updated At (احتياط)
    const core =
      (p?.['Patient Name']||'') + '|' +
      (p?.['Diagnosis']||'') + '|' +
      (p?.['Room']||'') + '|' +
      (p?.['Patient Assessment']||'');
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
   Summary generation
   ========================= */
function toShort(text, maxLines = 6) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length <= maxLines) return lines.join('\n');
  return lines.slice(0, maxLines).join('\n') + '\n…';
}

function ensureSummary(code) {
  const b = bundleFor(code);
  if (!b) return { text: '(not found)', shortText: '(not found)' };
  const ver = Cache.versionFor(b.patient, b.esas, b.ctcae, b.labs);
  const cached = Cache.get(code, ver);
  if (cached) return { text: cached.text, shortText: cached.shortText };

  const text = AIModule.localHeuristicSummary(b);
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
  card.style.gap = '6px';

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

  const pre = document.createElement('pre');
  pre.className = 'mono small';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.lineHeight = '1.3';
  pre.textContent = showText || '(empty)';

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
    const nowCompact = btnToggle.innerText.trim().startsWith('Expand') ? false : true;
    // إعادة العرض السريع
    pre.textContent = nowCompact ? (ensureSummary(code).shortText || '') : (ensureSummary(code).text || '');
    btnToggle.innerHTML = nowCompact
      ? `<span class="mi md">expand_more</span>&nbsp;Expand`
      : `<span class="mi md">expand_less</span>&nbsp;Collapse`;
  });

  row.appendChild(btnCopy);
  row.appendChild(btnToggle);

  card.appendChild(head);
  card.appendChild(pre);
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
      qsa('.card pre', body).forEach(pre=>{
        // عرض مختصر لكل البطاقات
        const codeEl = pre.closest('.card')?.querySelector('.mono.small.muted'); // غير مضمون
      });
      // طريقة بسيطة: أعد البناء مختصر لهذا القسم
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
   Public API
   ========================= */
export const Summaries = {
  init(bus, state) {
    Bus = bus; State = state;

    // تجهيز المودال إن لم يوجد
    ensureModalScaffold();

    // أحداث تغيّر البيانات → إبطال كاش المريض
    Bus?.on?.('esas.changed',  ({ code }) => Cache.invalidate(code));
    Bus?.on?.('ctcae.changed', ({ code }) => Cache.invalidate(code));
    Bus?.on?.('labs.changed',  ({ code }) => Cache.invalidate(code));
    // ملاحظة: تغييرات حقول المريض البيوغرافية لا تملك حدثًا عامًا؛
    // سنعيد البناء عند الفتح والبحث، وهذا كافٍ للاستخدام اليومي.

    // ربط أدوات الواجهة
    const search = document.getElementById('summaries-search');
    const compact = document.getElementById('summaries-compact');
    const printBtn = document.getElementById('summaries-print');
    const root = document.getElementById('summaries-root');

    if (search && root) {
      search.addEventListener('input', Utils.debounce(() => {
        renderListRoot(root, search.value || '', !!compact?.checked);
      }, 200));
    }
    if (compact && root) {
      compact.addEventListener('change', () => {
        renderListRoot(root, search?.value || '', !!compact.checked);
      });
    }
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        this.printAll(search?.value || '', !!compact?.checked);
      });
    }

    // Close via backdrop delegated by ui.js already
  },

  open() {
    const modal = ensureModalScaffold();
    // توليد القائمة من الحالة الحالية
    const root = document.getElementById('summaries-root');
    const search = document.getElementById('summaries-search');
    const compact = document.getElementById('summaries-compact');

    // إعادة بناء كاملة عند كل فتح
    Cache.clear();
    renderListRoot(root, search?.value || '', !!compact?.checked);

    modal.classList.remove('hidden');
    document.documentElement.style.overflow = 'hidden';
  },

  close() {
    const modal = document.getElementById('summaries-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.documentElement.style.overflow = '';
  },

  refresh() {
    const root = document.getElementById('summaries-root');
    if (!root) return;
    const search = document.getElementById('summaries-search');
    const compact = document.getElementById('summaries-compact');
    renderListRoot(root, search?.value || '', !!compact?.checked);
  },

  // طباعة سريعة لكل الملخصات الظاهرة
  printAll(searchTerm = '', compact = true) {
    // نبني HTML بسيط للطباعة (A4-friendly) — بدون تعديل CSS أساسي
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
        const esc = s => String(s || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
        return `
          <div style="break-inside:avoid; margin:0 0 10px 0; padding:10px; border:1px solid var(--border); border-radius:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <div style="font-weight:700;">${esc(name)}</div>
              <div class="mono small muted">${esc(code)} • Updated ${esc(upd)}</div>
            </div>
            <pre class="mono small" style="white-space:pre-wrap; line-height:1.3;">${esc(body)}</pre>
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

    // حاوية الطباعة
    let printRoot = document.getElementById('summaries-print-root');
    if (!printRoot) {
      printRoot = document.createElement('div');
      printRoot.id = 'summaries-print-root';
      printRoot.style.display = 'none';
      document.body.appendChild(printRoot);
    }
    printRoot.innerHTML = pages;
    printRoot.style.display = '';
    document.body.setAttribute('data-printing','true');
    window.print();
    setTimeout(()=>{
      document.body.removeAttribute('data-printing');
      printRoot.style.display = 'none';
    }, 400);
  }
};
