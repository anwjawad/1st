// feature-pr-enhancements.js
// Enhancements (no core edits): room badge, show Diet on cards, rename Diet→Today's notes,
// staggered slide-in animations for cards + modal, full symptoms on cards + add to summaries.
// NEW: Per-card Highlight toggle (⭐) with persistent state in localStorage.

(async function init() {
  // ===== Helpers =====
  const wait = (ms)=>new Promise(r=>setTimeout(r,ms));
  async function waitReady(timeoutMs=15000){
    const t0=Date.now();
    while(Date.now()-t0<timeoutMs){
      if (document.querySelector('#patients-list') && document.querySelector('#sidebar')) return true;
      await wait(120);
    }
    return false;
  }
  await waitReady();

  // Import APIs safely (بدون لمس الكود)
  const Sheets   = (await import('./sheets.js')).Sheets;
  const AIModule = (await import('./ai.js')).AIModule;

  // ===== Data cache (patients by code) =====
  let byCode = new Map();
  async function refreshCache(){
    try{
      const data = await Sheets.loadAll();
      byCode = new Map((data?.patients||[]).map(p=>[p['Patient Code'], p]));
    }catch{ /* ignore (will retry on refresh) */ }
  }
  await refreshCache();

  // ===== Highlight (persistent) =====
  const HL_KEY = 'pr.highlighted.codes';
  function readHL(){
    try{ const a=JSON.parse(localStorage.getItem(HL_KEY)||'[]'); return Array.isArray(a)? new Set(a) : new Set(); }
    catch{ return new Set(); }
  }
  function writeHL(set){
    try{ localStorage.setItem(HL_KEY, JSON.stringify(Array.from(set.values()))); }catch{}
  }
  const highlighted = readHL();
  function isHighlighted(code){ return !!(code && highlighted.has(code)); }
  function toggleHighlight(code, on){
    if (!code) return;
    if (on===undefined) on = !highlighted.has(code);
    if (on) highlighted.add(code); else highlighted.delete(code);
    writeHL(highlighted);
    // حدّث الكارد إن كان موجودًا
    const card = document.querySelector(`.patient-card[data-code="${CSS.escape(code)}"]`);
    if (card) applyHighlightState(card, code);
  }
  function applyHighlightState(card, code){
    const on = isHighlighted(code);
    card.classList.toggle('pr-highlighted', on);
    const btn = card.querySelector('.pr-hl-btn');
    if (btn){
      btn.setAttribute('aria-pressed', on?'true':'false');
      btn.title = on ? 'Remove highlight' : 'Highlight this patient';
      btn.innerHTML = on ? '⭐' : '☆';
    }
  }

  // ===== Styles injection (badge + animations + highlight) =====
  (function injectCSS(){
    if (document.getElementById('pr-enhance-style')) return;
    const css = `
      /* Room badge */
      .pr-room-badge {
        display:inline-flex; align-items:center; gap:6px;
        padding:2px 10px; border-radius:999px;
        background: color-mix(in oklab, var(--primary) 55%, #000 45%);
        color:#fff; font-weight:800; letter-spacing:.3px; font-size:12.5px;
        box-shadow: 0 6px 22px color-mix(in oklab, var(--primary) 30%, transparent);
      }
      .pr-room-badge .dot { width:6px; height:6px; border-radius:50%; background:#fff; opacity:.9 }

      /* Diet chip */
      .row-chip.pr-diet { background: color-mix(in oklab, var(--accent) 28%, transparent); border:1px solid var(--border); }

      /* Slide-in cards (staggered) */
      @keyframes prSlideIn {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: none; }
      }
      .patient-card.pr-slide-in {
        opacity: 0;
        animation: prSlideIn calc(240ms * var(--motion-multiplier,1)) ease-out both;
        animation-delay: calc(var(--pr-idx, 0) * 40ms);
      }

      /* Modal animation */
      @keyframes prModalIn {
        from { opacity: 0; transform: translateY(14px) scale(.985); }
        to   { opacity: 1; transform: none; }
      }
      #patient-modal:not(.hidden) .modal-card { animation: prModalIn 240ms ease-out both; }

      /* Symptom pill styling reuse */
      .row-chip.pr-sym { background: color-mix(in oklab, var(--primary-2) 18%, transparent); }

      /* === Highlight button & state === */
      .pr-hl-btn {
        display:inline-flex; align-items:center; justify-content:center;
        width:28px; height:28px; border-radius:999px; border:1px solid var(--border);
        background: var(--glass); cursor:pointer; font-size:16px; line-height:1;
        transition: transform .12s ease, box-shadow .12s ease, background .2s ease;
      }
      .pr-hl-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.15); }
      .pr-hl-btn[aria-pressed="true"] { background: color-mix(in oklab, var(--primary) 18%, var(--glass)); border-color: color-mix(in oklab, var(--primary) 40%, var(--border)); }

      .patient-card.pr-highlighted {
        position: relative;
        border: 2px solid color-mix(in oklab, var(--primary) 55%, transparent) !important;
        box-shadow: 0 8px 40px color-mix(in oklab, var(--primary) 30%, transparent);
        border-radius: 12px;
      }
      .patient-card.pr-highlighted::after {
        content: '⭐ Highlighted';
        position: absolute; top: -10px; right: 8px;
        padding: 2px 8px; font-size: 12px; font-weight: 700; letter-spacing:.2px;
        color: var(--fg); background: color-mix(in oklab, var(--primary) 22%, var(--card));
        border: 1px solid color-mix(in oklab, var(--primary) 40%, var(--border));
        border-radius: 999px;
      }
    `.trim();
    const s = document.createElement('style');
    s.id = 'pr-enhance-style';
    s.textContent = css;
    document.head.appendChild(s);
  })();

  // ===== Utilities to enhance each patient card =====
  function fullSymptomsString(p){
    const s = (p?.['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean);
    return s;
  }
  function enhanceCard(card, idx=0){
    if (!card || card.__prEnhanced) return;
    card.__prEnhanced = true;

    // slide-in (stagger)
    card.classList.add('pr-slide-in');
    card.style.setProperty('--pr-idx', String(idx));

    const code = card.dataset.code || '';
    const p = byCode.get(code);

    // 1) Room badge
    const meta = card.querySelector('.row-sub');
    if (meta && !meta.__prRoomDone) {
      meta.__prRoomDone = true;
      const txt = meta.textContent || '';
      const m = txt.match(/Room\s+([^\s•]+)/i);
      if (m) {
        const room = m[1];
        const html = txt.replace(/Room\s+[^\s•]+/i,
          `Room <span class="pr-room-badge"><span class="dot"></span>${room}</span>`);
        meta.innerHTML = html;
      }
    }

    // 2) Diet on card (as chip)
    if (p && (p['Diet']||'').trim()) {
      const tags = card.querySelector('.row-tags');
      if (tags && !tags.querySelector('.pr-diet')) {
        const chip = document.createElement('span');
        chip.className = 'row-chip pr-diet';
        chip.title = "Today's notes";
        chip.textContent = p['Diet'];
        tags.appendChild(chip);
      }
    }

    // 5) Full symptoms on card (no +n)
    const symChip = card.querySelector('.row-chip.sym');
    if (symChip) {
      const arr = fullSymptomsString(p);
      if (arr.length) {
        symChip.textContent = arr.join(', ');
        symChip.classList.add('pr-sym');
        symChip.title = 'Symptoms';
      }
    } else if (p) {
      const arr = fullSymptomsString(p);
      if (arr.length) {
        const tags = card.querySelector('.row-tags');
        if (tags) {
          const chip = document.createElement('span');
          chip.className = 'row-chip sym pr-sym';
          chip.textContent = arr.join(', ');
          chip.title = 'Symptoms';
          tags.appendChild(chip);
        }
      }
    }

    // 6) Inject highlight control in header (left side before status badge)
    const header = card.querySelector('.row-header');
    if (header && !card.querySelector('.pr-hl-btn')) {
      const btn = document.createElement('button');
      btn.className = 'pr-hl-btn';
      btn.type = 'button';
      btn.title = 'Highlight this patient';
      btn.setAttribute('aria-pressed', 'false');

      // مكان الزر: قبل شارة الحالة (badge) ليكون دائمًا ظاهرًا
      const statusBadge = header.querySelector('.status');
      if (statusBadge && statusBadge.parentNode) {
        statusBadge.parentNode.insertBefore(btn, statusBadge);
      } else {
        header.appendChild(btn);
      }

      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const next = !isHighlighted(code);
        toggleHighlight(code, next);
      });
    }

    // طبّق حالة التظليل الحالية
    applyHighlightState(card, code);
  }

  // Enhance all current cards
  function enhanceAllCards(){
    const list = Array.from(document.querySelectorAll('#patients-list .patient-card'));
    list.forEach((c,i)=>enhanceCard(c,i));
  }
  enhanceAllCards();

  // Observe future renders
  const listRoot = document.getElementById('patients-list');
  const obs = new MutationObserver(()=>enhanceAllCards());
  if (listRoot) obs.observe(listRoot, { childList:true });

  // ===== 3) Rename UI label "Diet" → "Today's notes" (visual only) + affect summaries text
  function renameDietLabels(root=document){
    // Any field label with exact "Diet" → "Today's notes"
    root.querySelectorAll('.field .label, label.field .label, .label').forEach(el=>{
      if (String(el.textContent).trim() === 'Diet') el.textContent = "Today's notes";
    });
    // In any static text blocks that show "Diet:" lines
    root.querySelectorAll('*').forEach(el=>{
      if (el.childNodes && el.childNodes.length===1 && el.childNodes[0].nodeType===3) {
        const t = el.textContent;
        if (/^\s*Diet:\s*/.test(t)) el.textContent = t.replace(/^(\s*)Diet:/, "$1Today's notes:");
      }
    });
  }

  // Run on load & whenever patient modal opens
  renameDietLabels(document);
  const pm = document.getElementById('patient-modal');
  if (pm) {
    const mo = new MutationObserver(()=>{ if (!pm.classList.contains('hidden')) renameDietLabels(pm); });
    mo.observe(pm, { attributes:true, attributeFilter:['class'] });
  }

  // Patch the summary generator to (a) rename Diet→Today's notes, (b) include Symptoms section (full)
  if (AIModule && typeof AIModule.localHeuristicSummary === 'function') {
    const orig = AIModule.localHeuristicSummary.bind(AIModule);
    AIModule.localHeuristicSummary = function(bundle){
      const txt = orig(bundle) || '';
      const p = bundle?.patient || null;

      // Rename the Diet line label only (keep the same data value)
      const renamed = txt.replace(/^Diet:/m, "Today's notes:");

      // Append Symptoms block (full)
      let symBlock = '';
      if (p) {
        const syms = fullSymptomsString(p);
        const notesObj = (()=>{ try{return JSON.parse(p['Symptoms Notes']||'{}')}catch{return{}} })();
        if (syms.length){
          const lines = syms.map(s => {
            const n = notesObj && notesObj[s] ? ` (${notesObj[s]})` : '';
            return `• ${s}${n}`;
          });
          symBlock = ['','Symptoms:', ...lines].join('\n');
        }
      }
      return symBlock ? (renamed + '\n' + symBlock) : renamed;
    };
  }

  // Listen to Refresh to keep cache fresh
  document.getElementById('btn-refresh')?.addEventListener('click', async ()=>{
    await refreshCache();
    // re-enhance after data reload
    setTimeout(()=>{ 
      // تأكد من تطبيق التظليل بعد إعادة التحميل
      Array.from(document.querySelectorAll('#patients-list .patient-card')).forEach(card=>{
        applyHighlightState(card, card.dataset.code || '');
      });
      enhanceAllCards();
    }, 400);
  });

  // Also periodically refresh cache lightly (optional)
  setInterval(()=>refreshCache().catch(()=>{}), 60_000);
})();
