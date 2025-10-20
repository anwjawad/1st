// feature-print.js
// Custom Print (A4, per-section one page) with column selection & per-column widths,
// scaling, landscape/portrait, black text, dark headers, zebra rows.
// NO core edits. Reads data via Sheets.loadAll() only.

(async function init() {
  // ---------- Path resolver so it works from root or /js ----------
  function detectJsBase(){
    const el = Array.from(document.scripts).find(s => /\/js\/app\.js($|\?)/.test(s.src));
    if (el) return el.src.replace(/app\.js.*$/,''); // ends with .../js/
    return new URL('./js/', window.location.href).href;
  }
  const JS_BASE = detectJsBase();

  // ---------- Import project APIs (read-only) ----------
  const { Sheets } = await import(JS_BASE + 'sheets.js');

  // ---------- Wait for DOM ready enough ----------
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  async function waitReady(timeoutMs=15000){
    const t0=Date.now();
    while(Date.now()-t0<timeoutMs){
      if (document.querySelector('#sidebar')) return true;
      await sleep(120);
    }
    return false;
  }
  await waitReady();

  // ---------- Inject sidebar button ----------
  const host = document.querySelector('#sidebar') || document.body;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.id = 'btn-custom-print';
  btn.innerHTML = '<span class="mi md">print</span>&nbsp;Print (custom)';
  const ref = document.querySelector('#open-summaries')?.parentElement || host;
  ref.appendChild(btn);

  // ---------- Display-title map + default widths ----------
  const TITLE_MAP = {
    'Patient Code': 'Code',
    'Patient Age':  'Age',
    'Admitting Provider': 'PP'
    // others unchanged
  };
  const DEFAULT_WIDTHS = {
    'Patient Code': '16mm',
    'Patient Age':  '5mm',
    'Admitting Provider': '8mm',
    'Room': '8mm',
    'Diagnosis': '60mm'
  };

  // ---------- Style for modal + preview + LOADER ----------
  (function injectLocalCSS(){
    if (document.getElementById('print-custom-style')) return;
    const css = `
      .pc-flex { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; }
      .pc-grid { display:grid; gap:10px; grid-template-columns: repeat(2,minmax(0,1fr)); }
      .pc-row  { display:flex; gap:10px; flex-wrap:wrap; }
      .pc-colw { width:88px; }
      .pc-mm   { width:70px; }
      .pc-small{ font-size:12.5px; opacity:.85 }
      .pc-sep  { height:1px; background:var(--border); margin:8px 0 }
      .pc-note { font-size:12.5px; opacity:.8 }
      .pc-badge{ display:inline-block; padding:2px 8px; border:1px solid var(--border); border-radius:999px; }

      /* Preview "page" look */
      .pc-preview-wrap { background:#fff; border-radius:10px; border:1px solid var(--border);
        box-shadow: 0 10px 30px rgba(0,0,0,.25); padding:10px; }
      .pc-table-preview { max-height:40vh; overflow:auto; }
      .pc-table-preview table { background:#fff; }

      /* Modal as big card (85% of viewport) */
      #custom-print-modal .modal-card {
        width: 85vw !important;
        height: 85vh !important;
        max-width: 1200px;
        display: flex; flex-direction: column;
      }
      #custom-print-modal .modal-body { flex: 1 1 auto; overflow: auto; }

      /* ===== Floating FULLSCREEN loader overlay (blur page) ===== */
      #pc-loading { position:fixed; inset:0; display:grid; place-items:center;
        z-index: 9999; background: rgba(8,10,18,.32); backdrop-filter: blur(6px) saturate(120%); }
      #pc-loading.hidden { display:none; }
      #pc-loading .loader { --time-animation:2s; --size:1.1; }

      /* Base loader styles (Uiverse.io by andrew-manzyk) */
      .loader {
        --color-one: #ffbf48;
        --color-two: #be4a1d;
        --color-three: #ffbf4780;
        --color-four: #bf4a1d80;
        --color-five: #ffbf4740;
        position: relative;
        border-radius: 50%;
        transform: scale(var(--size));
        box-shadow:
          0 0 25px 0 var(--color-three),
          0 20px 50px 0 var(--color-four);
        animation: colorize calc(var(--time-animation) * 3) ease-in-out infinite;
      }
      .loader::before {
        content: "";
        position: absolute; top: 0; left: 0; width: 100px; height: 100px;
        border-radius: 50%;
        border-top: solid 1px var(--color-one);
        border-bottom: solid 1px var(--color-two);
        background: linear-gradient(180deg, var(--color-five), var(--color-four));
        box-shadow:
          inset 0 10px 10px 0 var(--color-three),
          inset 0 -10px 10px 0 var(--color-four);
      }
      .loader .box {
        width: 100px; height: 100px;
        background: linear-gradient(180deg, var(--color-one) 30%, var(--color-two) 70%);
        mask: url(#clipping);
        -webkit-mask: url(#clipping);
      }
      .loader svg { position: absolute; }
      .loader svg #clipping { filter: contrast(15); animation: roundness calc(var(--time-animation) / 2) linear infinite; }
      .loader svg #clipping polygon { filter: blur(7px); }
      .loader svg #clipping polygon:nth-child(1) { transform-origin: 75% 25%; transform: rotate(90deg); }
      .loader svg #clipping polygon:nth-child(2) { transform-origin: 50% 50%; animation: rotation var(--time-animation) linear infinite reverse; }
      .loader svg #clipping polygon:nth-child(3) { transform-origin: 50% 60%; animation: rotation var(--time-animation) linear infinite; animation-delay: calc(var(--time-animation) / -3); }
      .loader svg #clipping polygon:nth-child(4) { transform-origin: 40% 40%; animation: rotation var(--time-animation) linear infinite reverse; }
      .loader svg #clipping polygon:nth-child(5) { transform-origin: 40% 40%; animation: rotation var(--time-animation) linear infinite reverse; animation-delay: calc(var(--time-animation) / -2); }
      .loader svg #clipping polygon:nth-child(6) { transform-origin: 60% 40%; animation: rotation var(--time-animation) linear infinite; }
      .loader svg #clipping polygon:nth-child(7) { transform-origin: 60% 40%; animation: rotation var(--time-animation) linear infinite; animation-delay: calc(var(--time-animation) / -1.5); }

      @keyframes rotation { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes roundness {
        0%,60%,100% { filter: contrast(15); }
        20%,40% { filter: contrast(3); }
      }
      @keyframes colorize {
        0% { filter: hue-rotate(0deg); }
        20% { filter: hue-rotate(-30deg); }
        40% { filter: hue-rotate(-60deg); }
        60% { filter: hue-rotate(-90deg); }
        80% { filter: hue-rotate(-45deg); }
        100% { filter: hue-rotate(0deg); }
      }

      /* Theme-aware colors */
      /* neon → teal/cyan */
      [data-theme="neon"] #pc-loading .loader {
        --color-one: #00ffd1;
        --color-two: #00a3ff;
        --color-three: #00ffd180;
        --color-four: #00a3ff80;
        --color-five: #00ffd140;
      }
      /* ocean → blue tones */
      [data-theme="ocean"] #pc-loading .loader {
        --color-one: #40a0ff;
        --color-two: #2463ff;
        --color-three: #40a0ff80;
        --color-four: #2463ff80;
        --color-five: #40a0ff40;
      }
      /* rose → pink/magenta */
      [data-theme="rose"] #pc-loading .loader {
        --color-one: #ff64a0;
        --color-two: #ff3c7d;
        --color-three: #ff64a080;
        --color-four: #ff3c7d80;
        --color-five: #ff64a040;
      }
    `.trim();
    const s = document.createElement('style');
    s.id='print-custom-style'; s.textContent=css; document.head.appendChild(s);
  })();

  // ---------- Modal scaffold (self-contained, no ui.js dependency) ----------
  function ensureModal(){
    if (document.getElementById('custom-print-modal')) return;
    const m = document.createElement('div');
    m.id = 'custom-print-modal';
    m.className = 'modal hidden';
    m.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" style="max-width:1000px; width:calc(100% - 24px)">
        <div class="modal-header">
          <div class="card-title"><span class="mi md">print</span>&nbsp; Custom Print (A4 per Section)</div>
          <button class="icon-btn" data-close-modal="custom-print-modal" aria-label="Close"><span class="mi md">close</span></button>
        </div>
        <div class="modal-body modal-body-pad">
          <div class="section">
            <div class="section-head"><div class="block-title">Layout</div></div>
            <div class="pc-row">
              <label class="field">
                <span class="label">Orientation</span>
                <select id="pc-orient">
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label class="field">
                <span class="label">Scale (table font size)</span>
                <input id="pc-scale" type="number" min="8" max="18" step="0.5" value="11" />
              </label>
              <label class="checkbox">
                <input id="pc-wrap" type="checkbox" checked />
                <span>Wrap long text</span>
              </label>
              <label class="checkbox" title="Try to keep each section to exactly one page">
                <input id="pc-fit" type="checkbox" checked />
                <span>One page per Section</span>
              </label>
              <button id="pc-apply" class="btn" style="margin-left:auto"><span class="mi md">refresh</span>&nbsp;Apply</button>
            </div>
          </div>

          <div class="section">
            <div class="section-head"><div class="block-title">Columns</div></div>
            <div class="pc-grid">
              <label class="checkbox"><input class="pc-col" data-key="Patient Code"        type="checkbox" checked /><span>Patient Code</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Patient Name"        type="checkbox" checked /><span>Patient Name</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Patient Age"         type="checkbox" checked /><span>Patient Age (years only)</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Room"                type="checkbox" checked /><span>Room</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Admitting Provider"  type="checkbox" checked /><span>Admitting Provider (first name)</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Diagnosis"           type="checkbox" checked /><span>Diagnosis (first sentence)</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Patient Assessment"  type="checkbox" checked /><span>Assessment</span></label>
              <label class="checkbox"><input class="pc-col" data-key="LABS"                type="checkbox" checked /><span>LABS (abnormal)</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Regular Meds"        type="checkbox" checked /><span>Regular Medications</span></label>
              <label class="checkbox"><input class="pc-col" data-key="PRN Meds"            type="checkbox" checked /><span>PRN Medications</span></label>
              <label class="checkbox"><input class="pc-col" data-key="Plan"                type="checkbox" /><span>Plan (optional)</span></label>
            </div>

            <div class="pc-sep"></div>

            <div class="pc-row pc-small">
              <span class="pc-badge">Widths (mm or %)</span>
              <span>Leave empty = auto</span>
            </div>
            <div id="pc-widths" class="pc-grid"></div>

            <div class="pc-sep"></div>

            <div class="pc-row">
              <label class="field">
                <span class="label">Diagnosis mode</span>
                <select id="pc-dx-mode">
                  <option value="first">First sentence only</option>
                  <option value="full-small">Full text (smaller font)</option>
                </select>
              </label>
            </div>
          </div>

          <div class="section">
            <div class="section-head"><div class="block-title">Preview (sample)</div></div>
            <div class="pc-preview-wrap">
              <div class="pc-table-preview">
                <table id="pc-preview" class="mono small" style="border-collapse:collapse; width:100%"></table>
              </div>
            </div>
            <div class="pc-note" style="margin-top:6px">Final output opens in a print window and applies A4, headers darker, black text, zebra rows, and per-section page break. Use the scale to fit exactly one page per section.</div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="pc-open" class="btn btn-primary"><span class="mi md">print</span>&nbsp;Open Print View</button>
          <button class="btn" data-close-modal="custom-print-modal">Close</button>
        </div>
      </div>`;
    document.body.appendChild(m);

    m.addEventListener('click', (e)=>{
      if (e.target.closest('[data-close-modal="custom-print-modal"]') || e.target === m) {
        m.classList.add('hidden');
        document.documentElement.style.overflow = '';
      }
    });
  }

  // ---------- Loader overlay scaffold ----------
  function ensureLoader(){
    if (document.getElementById('pc-loading')) return;
    const wrap = document.createElement('div');
    wrap.id = 'pc-loading';
    wrap.className = 'hidden';
    wrap.setAttribute('aria-hidden','true');
    wrap.innerHTML = `
      <div class="loader" role="status" aria-label="Loading">
        <div class="box"></div>
        <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <mask id="clipping">
              <polygon fill="black" points="0,0 100,0 100,100 0,100"></polygon>
              <polygon fill="white" points="50,0 100,50 50,100 0,50"></polygon>
              <polygon fill="white" points="50,10 90,50 50,90 10,50"></polygon>
              <polygon fill="white" points="60,10 90,50 60,90 30,50"></polygon>
              <polygon fill="white" points="40,10 70,50 40,90 10,50"></polygon>
              <polygon fill="white" points="55,20 80,50 55,80 30,50"></polygon>
              <polygon fill="white" points="45,20 70,50 45,80 20,50"></polygon>
            </mask>
          </defs>
        </svg>
      </div>
    `;
    document.body.appendChild(wrap);
  }
  function showLoader(){
    ensureLoader();
    const el = document.getElementById('pc-loading');
    el.classList.remove('hidden');
    document.documentElement.style.overflow='hidden';
  }
  function hideLoader(){
    const el = document.getElementById('pc-loading');
    if (!el) return;
    el.classList.add('hidden');
    document.documentElement.style.overflow='';
  }

  function openModal(){
    const m = document.getElementById('custom-print-modal');
    m.classList.remove('hidden');
    document.documentElement.style.overflow = 'hidden';
  }

  // ---------- Column width controls ----------
  const ALL_COLUMNS = [
    'Patient Code','Patient Name','Patient Age','Room','Admitting Provider','Diagnosis',
    'Patient Assessment','LABS','Regular Meds','PRN Meds','Plan'
  ];
  function renderWidthInputs(){
    const host = document.getElementById('pc-widths');
    host.innerHTML = '';
    ALL_COLUMNS.forEach(key=>{
      const w = document.createElement('label');
      w.className = 'field';
      const def = DEFAULT_WIDTHS[key] || '';
      w.innerHTML = `
        <span class="label">${key}</span>
        <input class="pc-width pc-mm" data-key="${key}" type="text" placeholder="e.g., 18mm or 12%" value="${def}"/>
      `;
      host.appendChild(w);
    });
  }

  // ---------- Helpers: data formatting ----------
  function onlyYears(v){
    const s = String(v||'').match(/\d+/);
    return s ? s[0] : '';
  }
  function firstName(v){
    const s = String(v||'').trim();
    if (!s) return '';
    return s.split(/\s+/)[0] || s;
  }
  function firstSentence(v){
    const s = String(v||'').trim();
    if (!s) return '';
    const m = s.match(/(.+?[.؟!。]|.+$)/);
    return m ? m[1].trim() : s;
  }
  function codeNumberOnly(v){
    const m = String(v||'').match(/\d+/);
    return m ? m[0] : '';
  }
  function splitMeds(text){
    const lines = String(text||'').split(/\r?\n|;+/).map(s=>s.trim()).filter(Boolean);
    const regular=[], prn=[];
    lines.forEach(l=>{
      if (/(\bPRN\b|\bas needed\b)/i.test(l)) prn.push(l);
      else regular.push(l);
    });
    return { regular: regular.join('; '), prn: prn.join('; ') };
  }

  // labs abnormal summary (fallback)
  const LAB_REF = {
    'WBC':[4.0,11.0],'HGB':[12.0,16.0],'PLT':[150,450],'ANC':[1.5,8.0],'CRP':[0,5],
    'Albumin':[3.5,5.0],'Sodium (Na)':[135,145],'Potassium (K)':[3.5,5.1],'Chloride (Cl)':[98,107],
    'Calcium (Ca)':[8.5,10.5],'Phosphorus (Ph)':[2.5,4.5],'Alkaline Phosphatase (ALP)':[44,147],
    'Creatinine (Scr)':[0.6,1.3],'BUN':[7,20],'Total Bile':[0.1,1.2]
  };
  const shortKey = k => k.replace('Alkaline Phosphatase (ALP)','ALP')
    .replace('Creatinine (Scr)','Scr').replace('Sodium (Na)','Na')
    .replace('Potassium (K)','K').replace('Chloride (Cl)','Cl')
    .replace('Calcium (Ca)','Ca').replace('Phosphorus (Ph)','Ph');
  function parseNum(v){ if (v==null) return null; if (typeof v==='number') return Number.isFinite(v)?v:null; const m=String(v).trim().match(/-?\d+(\.\d+)?/); return m?parseFloat(m[0]):null; }
  function abnormalFromRecord(labsRec){
    if (!labsRec) return '';
    const arr=[];
    Object.keys(LAB_REF).forEach(k=>{
      const [lo,hi]=LAB_REF[k]; const n=parseNum(labsRec[k]);
      if (n==null) return;
      if (n<lo) arr.push(shortKey(k)+'↓'); else if (n>hi) arr.push(shortKey(k)+'↑');
    });
    return arr.join(', ');
  }

  // ---------- Data pull + build preview ----------
  let SNAP = null;
  async function snapshot(){
    const data = await Sheets.loadAll();
    const sections = data.sections?.length ? data.sections : ['Default'];
    const pats = Array.isArray(data.patients) ? data.patients : [];
    const labs = Array.isArray(data.labs) ? data.labs : [];

    const labsMap = new Map();
    labs.forEach(r => { if (r && r['Patient Code']) labsMap.set(r['Patient Code'], r); });

    SNAP = { sections, patients: pats, labsMap };
    return SNAP;
  }

  function gatherSelectedColumns(){
    return Array.from(document.querySelectorAll('.pc-col'))
      .filter(cb=>cb.checked)
      .map(cb=>cb.getAttribute('data-key'));
  }
  function gatherWidths(){
    const map = {};
    document.querySelectorAll('.pc-width').forEach(inp=>{
      const k = inp.getAttribute('data-key');
      const v = (inp.value||'').trim();
      if (v) map[k]=v; // allow units mm/%/px
    });
    return map;
  }

  function medsFor(p){
    const { regular, prn } = splitMeds(p['Medication List']||'');
    return { regular, prn };
  }
  function labsFor(p){
    const preset = p['Labs Abnormal'] || '';
    if (preset) return preset;
    const rec = SNAP.labsMap.get(p['Patient Code']);
    return abnormalFromRecord(rec);
  }
  function dxFor(p, mode){
    const full = String(p['Diagnosis']||'').trim();
    if (mode==='full-small') return full;
    return firstSentence(full);
  }
  function ageFor(p){ return onlyYears(p['Patient Age']); }
  function provFor(p){ return firstName(p['Admitting Provider']); }
  function codeFor(p){ return codeNumberOnly(p['Patient Code']); }

  function renderPreview(){
    if (!SNAP) return;
    const table = document.getElementById('pc-preview');
    table.innerHTML='';

    const cols = gatherSelectedColumns();
    if (!cols.length){
      table.innerHTML='<tbody><tr><td class="small muted">No columns selected.</td></tr></tbody>';
      return;
    }

    // Head
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    cols.forEach(h=>{
      const th = document.createElement('th');
      th.textContent = TITLE_MAP[h] || h;     // <<< short titles
      th.style.padding = '6px 8px';
      th.style.border = '1px solid var(--border)';
      th.style.background = 'rgba(0,0,0,.14)';
      th.style.color = '#000';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    // Body (sample)
    const tbody = document.createElement('tbody');
    const sample = SNAP.patients.slice(0, 6);
    sample.forEach((p, idx)=>{
      const tr = document.createElement('tr');
      tr.style.background = idx % 2 ? 'rgba(0,0,0,.04)' : 'transparent';
      cols.forEach(c=>{
        const td = document.createElement('td');
        td.style.border = '1px solid var(--border)';
        td.style.padding = '6px 8px';
        td.style.color = '#000';
        let val = '';
        switch(c){
          case 'Patient Code':       val = codeFor(p); break; // <<< number only
          case 'Patient Age':        val = ageFor(p); break;
          case 'Admitting Provider': val = provFor(p); break;
          case 'Diagnosis':          val = dxFor(p, document.getElementById('pc-dx-mode').value); break;
          case 'Patient Assessment': val = p['Patient Assessment']||''; break;
          case 'LABS':               val = labsFor(p); break;
          case 'Regular Meds':       val = medsFor(p).regular; break;
          case 'PRN Meds':           val = medsFor(p).prn; break;
          case 'Plan':               val = p['Plan']||''; break;
          default:                   val = p[c]||'';
        }
        td.textContent = val;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // apply preview scale (table font size)
    const scale = Number(document.getElementById('pc-scale')?.value || 11);
    table.style.fontSize = `${scale}px`;
  }

  // ---------- Build print HTML ----------
  function buildPrintHTML(opts){
    const { orient, scalePx, wrap, fit, cols, widths } = opts;
    const now = new Date();
    const esc = s => String(s||'').replace(/[&<>]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
    const css = `
      @page { size: A4 ${orient}; margin: 10mm; }
      html, body { padding:0; margin:0; }
      body { color:#000; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
      .page { page-break-after: always; }
      .title { font-weight:800; font-size:14px; margin-bottom:6px; }
      table { border-collapse: collapse; width: 100%; table-layout: fixed; }
      thead th { background: #e0e0e0; color:#000; border:1px solid #999; padding:6px 6px; font-weight:700; }
      tbody td { border:1px solid #999; padding:4px 6px; color:#000; vertical-align: top; }
      tbody tr:nth-child(odd)  { background:#f6f6f6; }
      tbody tr:nth-child(even) { background:transparent; }
      .small { font-size:${Math.max(scalePx-1, 8)}px }
      .diag-full { font-size:${Math.max(scalePx-2, 8)}px }
      .nowrap { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wrap   { white-space:normal; word-break:break-word; }
    `.trim();

    function colWidthStyle(){
      const arr = [];
      Object.entries(widths||{}).forEach(([k,v])=>{
        const safeKey = (TITLE_MAP[k] || k).replace(/\s+/g,'-').toLowerCase();
        arr.push(`.col-${safeKey} { width: ${v}; }`);
      });
      return arr.join('\n');
    }

    function headRow(){
      return '<tr>' + cols.map(k=>{
        const title = TITLE_MAP[k] || k;                   // <<< short titles
        const cls = 'col-' + title.replace(/\s+/g,'-').toLowerCase();
        return `<th class="${cls}">${esc(title)}</th>`;
      }).join('') + '</tr>';
    }

    function cellFor(p, key){
      switch(key){
        case 'Patient Code':       return esc(codeNumberOnly(p['Patient Code'])); // <<< number only
        case 'Patient Age':        return esc(onlyYears(p['Patient Age']));
        case 'Admitting Provider': return esc(firstName(p['Admitting Provider']));
        case 'Diagnosis': {
          const mode = document.getElementById('pc-dx-mode').value;
          const txt  = dxFor(p, mode);
          const cls  = mode==='full-small' ? 'diag-full' : '';
          return `<div class="${wrap?'wrap':'nowrap'} ${cls}">${esc(txt)}</div>`;
        }
        case 'Patient Assessment': return `<div class="${wrap?'wrap':'nowrap'}">${esc(p['Patient Assessment']||'')}</div>`;
        case 'LABS':               return `<div class="${wrap?'wrap':'nowrap'} small">${esc(labsFor(p))}</div>`;
        case 'Regular Meds': {
          const { regular } = medsFor(p);
          return `<div class="${wrap?'wrap':'nowrap'} small">${esc(regular)}</div>`;
        }
        case 'PRN Meds': {
          const { prn } = medsFor(p);
          return `<div class="${wrap?'wrap':'nowrap'} small">${esc(prn)}</div>`;
        }
        case 'Plan':               return `<div class="${wrap?'wrap':'nowrap'}">${esc(p['Plan']||'')}</div>`;
        default:                   return `<div class="${wrap?'wrap':'nowrap'}">${esc(p[key]||'')}</div>`;
      }
    }

    function tableForSection(sec, list){
      const rows = list.map((p)=> {
        const tds = cols.map(k=>`<td>${cellFor(p,k)}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      const head = headRow();
      const title = `<div class="title">Section: ${esc(sec)} — ${now.toISOString().slice(0,16).replace('T',' ')}</div>`;
      const tableStyle = `font-size:${scalePx}px;`;
      return `
        <div class="page">
          ${title}
          <table style="${tableStyle}">
            <thead>${head}</thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }

    // Group patients by section
    const bySec = new Map();
    (SNAP.patients||[]).forEach(p=>{
      const sec = p.Section || 'Default';
      if (!bySec.has(sec)) bySec.set(sec, []);
      bySec.get(sec).push(p);
    });

    const pages = Array.from(bySec.entries()).map(([sec, arr]) => tableForSection(sec, arr)).join('\n');

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Print — Palliative Rounds</title>
          <style>${css}\n${colWidthStyle()}</style>
        </head>
        <body>
          ${pages}
          <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 50); };</script>
        </body>
      </html>
    `;
  }

  // ---------- Wire modal behavior ----------
  btn.addEventListener('click', async ()=>{
    // Show themed loader + blur page while preparing modal
    showLoader();
    try{
      ensureModal();
      renderWidthInputs();          // defaults filled here
      await snapshot();             // can take a bit → keep loader visible
      openModal();                  // show the modal
      renderPreview();              // fill sample preview
    } finally {
      hideLoader();                 // always hide, even if something failed
    }
  });

  // Apply button for manual preview refresh
  document.addEventListener('click', (e)=>{
    if (e.target.closest('#pc-apply')) {
      renderPreview();
    }
  });

  document.addEventListener('change', (e)=>{
    const modal = document.getElementById('custom-print-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.target.matches('.pc-col') || e.target.matches('#pc-dx-mode') || e.target.matches('#pc-orient')) {
      // keep live if you want, or comment out to depend strictly on Apply:
      renderPreview();
    }
  });

  document.addEventListener('input', (e)=>{
    const modal = document.getElementById('custom-print-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.target.matches('#pc-scale') || e.target.matches('.pc-width') || e.target.matches('#pc-wrap')) {
      // keep live update; Apply also available
      renderPreview();
    }
  });

  // Delegate click for opening print window
  document.addEventListener('click', async (e)=>{
    const openBtn = e.target.closest('#pc-open');
    if (!openBtn) return;

    const orient = document.getElementById('pc-orient').value;
    const scale  = Number(document.getElementById('pc-scale').value || 11);
    const wrap   = !!document.getElementById('pc-wrap').checked;
    const fit    = !!document.getElementById('pc-fit').checked;
    const cols   = gatherSelectedColumns();
    const widths = gatherWidths();

    if (!SNAP) await snapshot();
    const html = buildPrintHTML({ orient, scalePx: scale, wrap, fit, cols, widths });

    const w = window.open('', '_blank');
    if (!w) { alert('Popup blocked. Allow popups for this site to print.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  });

})();
