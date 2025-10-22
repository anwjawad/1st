// feature-pr-enhancements.js
// Enhancements (no core edits): room badge, show Diet on cards, rename Diet→Today's notes,
// staggered slide-in animations for cards + modal, full symptoms on cards + add to summaries.
// UPDATED: Highlight toggle (⭐) with Sheet persistence; falls back to [HL] tag in Comments if 'Highlighted' field is unavailable.

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
      // بعد إعادة التحميل، طبّق حالات التظليل الحالية على البطاقات
      setTimeout(()=>{
        document.querySelectorAll('#patients-list .patient-card').forEach(card=>{
          applyHighlightState(card, card.dataset.code || '');
        });
      }, 0);
    }catch{ /* ignore (will retry on refresh) */ }
  }
  await refreshCache();

  // ===== Highlight logic (Sheet + fallback to Comments [HL]) =====
  const HL_TAG = '[HL]';

  function hasHLTagInComments(p){
    const c = String(p?.['Comments'] ?? '');
    return c.includes(HL_TAG);
  }

  function normalizeBool(v){
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '✅';
  }

  // هل المريض مفعّل له Highlight؟ (يفضّل حقل Highlighted، وإلا fallback على Comments)
  function isHighlighted(code){
    if (!code) return false;
    const p = byCode.get(code);
    if (!p) return false;
    if ('Highlighted' in p && String(p['Highlighted']).trim() !== '') {
      return normalizeBool(p['Highlighted']);
    }
    return hasHLTagInComments(p);
  }

  // تطبيق UI لنتيجة معينة
  function applyUI(code, on){
    const card = document.querySelector(`.patient-card[data-code="${CSS.escape(code)}"]`);
    if (card){
      card.classList.toggle('pr-highlighted', !!on);
      const btn = card.querySelector('.pr-hl-btn');
      if (btn){
        btn.setAttribute('aria-pressed', on?'true':'false');
        btn.title = on ? 'Remove highlight' : 'Highlight this patient';
        btn.innerHTML = on ? '⭐' : '☆';
      }
    }
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

  // تعديل Comments بإضافة/حذف الوسم [HL]
  function updateCommentsHLText(current, wantOn){
    const c = String(current ?? '');
    const has = c.includes(HL_TAG);
    if (wantOn && !has) {
      // أضف الوسم بشكل أنيق في بداية التعليق (أو فراغ إن فاضي)
      return (c.trim().length ? `${HL_TAG} ${c}` : HL_TAG);
    }
    if (!wantOn && has) {
      return c.replace(HL_TAG, '').replace(/\s{2,}/g, ' ').trim();
    }
    return c;
  }

  // Toggle مع محاولة الكتابة إلى Highlighted، والـ fallback إلى Comments عند فشل الحقل
  async function toggleHighlight(code, nextOn){
    if (!code) return;
    const p = byCode.get(code) || {};
    const old = isHighlighted(code);
    if (nextOn === undefined) nextOn = !old;

    // Optimistic UI
    applyUI(code, nextOn);

    // 1) حاول نكتب إلى حقل Highlighted (إذا السيرفر يدعمه)
    try{
      await Sheets.setHighlighted(code, !!nextOn); // تعتمد على sheets.js
      // حدّث الكاش المحلي
      if (p) p['Highlighted'] = nextOn ? 'TRUE' : 'FALSE';
      return;
    }catch(err){
      const msg = String(err?.message || err || '');
      // إن لم تكن مشكلة "Invalid field" رجّع UI وتوقّف
      if (!/Invalid field: ?Highlighted/i.test(msg)) {
        console.error('Highlight update failed:', err);
        applyUI(code, old);
        alert('Failed to update highlight. Please try again.');
        return;
      }
      // Otherwise: ننتقل لـ fallback
    }

    // 2) Fallback إلى Comments بإدراج/حذف [HL]
    try{
      const newComments = updateCommentsHLText(p['Comments'], !!nextOn);
      await Sheets.writePatientField(code, 'Comments', newComments);
      // حدّث الكاش
      p['Comments'] = newComments;
      // لا تغيّر p['Highlighted'] هنا (حتى لا نخلط بين الآليتين)
    }catch(err2){
      console.error('Fallback to Comments failed:', err2);
      // تراجع UI لو فشل الاثنان
      applyUI(code, old);
      alert('Failed to update highlight (fallback). Please try again.');
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

    // طبّق حالة التظليل الحالية (من الشيت أو من Comments fallback)
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
    root.querySelectorAll('.field .label, label.field .label, .label').forEach(el=>{
      if (String(el.textContent).trim() === 'Diet') el.textContent = "Today's notes";
    });
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

      const renamed = txt.replace(/^Diet:/m, "Today's notes:");
      let symBlock = '';
      if (p) {
        const syms = (p?.['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean);
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
    setTimeout(()=>{ 
      Array.from(document.querySelectorAll('#patients-list .patient-card')).forEach(card=>{
        applyHighlightState(card, card.dataset.code || '');
      });
      enhanceAllCards();
    }, 400);
  });

  // Also periodically refresh cache lightly (optional)
  setInterval(()=>refreshCache().catch(()=>{}), 60_000);
})();
