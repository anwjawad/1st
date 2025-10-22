// feature-pr-enhancements.js
// Enhancements (no core edits): room badge, show Diet on cards, rename Diet→Today's notes,
// staggered slide-in animations for cards + modal, full symptoms on cards + add to summaries.
// UPDATED: Highlight toggle (⭐) with per-patient label/name.
// Persist strategy:
//   1) Try write fields: Highlighted (TRUE/FALSE) + Highlight Note (text).
//   2) If server rejects (Invalid field), fallback to Comments token: [HL] or [HL: label].

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

  // ===== Highlight logic (Sheet + fallback to Comments [HL] / [HL: label]) =====
  const HL_TAG = '[HL]';
  const HL_RE  = /\[HL(?::([^\]]+))?\]/;  // يلتقط [HL] أو [HL: نص]

  function parseHLFromComments(txt){
    const c = String(txt ?? '');
    const m = c.match(HL_RE);
    if (!m) return { on:false, note:'' };
    const note = (m[1] || '').trim();
    return { on:true, note };
  }

  function normalizeBool(v){
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === '✅';
  }

  function getHLInfo(code){
    const p = byCode.get(code);
    if (!p) return { on:false, note:'' };
    // أولوية لحقل Highlighted / Highlight Note إن وُجد
    const hasField = ('Highlighted' in p) && String(p['Highlighted']).trim() !== '';
    const on = hasField ? normalizeBool(p['Highlighted']) : parseHLFromComments(p['Comments']).on;
    let note = '';
    if (on){
      if ('Highlight Note' in p && String(p['Highlight Note']).trim() !== '') {
        note = String(p['Highlight Note']).trim();
      } else {
        note = parseHLFromComments(p['Comments']).note;
      }
    }
    return { on, note };
  }

  function isHighlighted(code){ return getHLInfo(code).on; }
  function getHighlightNote(code){ return getHLInfo(code).note; }

  // إنشاء / تعديل token داخل Comments
  function makeCommentsWithHL(current, on, note){
    let c = String(current ?? '');
    // احذف أي HL موجود
    c = c.replace(HL_RE, '').replace(/\s{2,}/g,' ').trim();
    if (on){
      const token = (note && note.trim()) ? `[HL: ${note.trim()}]` : HL_TAG;
      return (c ? `${token} ${c}` : token);
    }
    return c;
  }

  // ===== Persistence helpers =====
  async function persistHL_Sheet(code, on, note){
    // نجرب حقلين معًا إن توفر writeMany، وإلا نعمل حقلاً حقلاً:
    try{
      if (Sheets.writePatientFields){
        const fields = { 'Highlighted': on ? 'TRUE' : 'FALSE' };
        if (note !== undefined) fields['Highlight Note'] = note || '';
        await Sheets.writePatientFields(code, fields);
      }else{
        await Sheets.writePatientField(code, 'Highlighted', on ? 'TRUE' : 'FALSE');
        if (note !== undefined) await Sheets.writePatientField(code, 'Highlight Note', note || '');
      }
      // حدّث الكاش
      const p = byCode.get(code);
      if (p){ p['Highlighted'] = on ? 'TRUE' : 'FALSE'; p['Highlight Note'] = note || ''; }
      return true;
    }catch(err){
      const msg = String(err?.message || err || '');
      // إذا كان الرفض بسبب أي من الحقلين، نرجع false لنتحوّل للفولباك
      if (/Invalid field:\s*Highlighted/i.test(msg) || /Invalid field:\s*Highlight Note/i.test(msg)) {
        return false;
      }
      // لأخطاء أخرى: نرميها لكي تُعالج أعلى
      throw err;
    }
  }

  async function persistHL_FallbackComments(code, on, note){
    const p = byCode.get(code) || {};
    const nextComments = makeCommentsWithHL(p['Comments'], on, note);
    await Sheets.writePatientField(code, 'Comments', nextComments);
    // حدّث الكاش
    if (p) p['Comments'] = nextComments;
    return true;
  }

  // ===== UI helpers =====
  function ensureHLNoteChip(card){
    let chip = card.querySelector('.pr-hl-note');
    if (!chip){
      chip = document.createElement('span');
      chip.className = 'row-chip pr-hl-note';
      const tags = card.querySelector('.row-tags') || card.querySelector('.row-header') || card;
      tags.appendChild(chip);
    }
    return chip;
  }

  function renderHLUI(code){
    const card = document.querySelector(`.patient-card[data-code="${CSS.escape(code)}"]`);
    if (!card) return;
    const { on, note } = getHLInfo(code);
    card.classList.toggle('pr-highlighted', !!on);
    const btn = card.querySelector('.pr-hl-btn');
    if (btn){
      btn.setAttribute('aria-pressed', on?'true':'false');
      btn.title = on ? (note ? `Highlighted: ${note}` : 'Remove highlight') : 'Highlight this patient';
      btn.innerHTML = on ? '⭐' : '☆';
    }
    // Chip: يظهر فقط لو فيه note
    let chip = card.querySelector('.pr-hl-note');
    if (note && on){
      chip = chip || ensureHLNoteChip(card);
      chip.textContent = `⭐ ${note}`;
      chip.style.display = '';
      chip.title = 'Highlight note';
    } else if (chip){
      chip.style.display = 'none';
    }
  }

  function applyUI(code, on, note){
    // نحدّث بيانات الكاش مؤقتًا قبل الكتابة لنعكس UI مباشرة
    const p = byCode.get(code) || {};
    if ('Highlighted' in p) p['Highlighted'] = on ? 'TRUE' : 'FALSE';
    if ('Highlight Note' in p || note !== undefined) p['Highlight Note'] = note || '';
    // إن ما عندنا حقل، نخلي UI يعتمد على Comments عند الفولباك لاحقًا
    renderHLUI(code);
  }

  function applyHighlightState(card, code){ renderHLUI(code); }

  function promptForLabel(defaultText=''){
    const v = prompt('أدخل اسم الهايلايت (اختياري):', defaultText || '');
    if (v == null) return null; // cancel
    return v.trim();
  }

  // ===== Toggle & note editing =====
  async function toggleHighlight(code, nextOn, maybePrompt=false){
    if (!code) return;
    const { on:oldOn, note:oldNote } = getHLInfo(code);
    if (nextOn === undefined) nextOn = !oldOn;

    // لو فعّلنا الآن وطلبت فتح prompt، اسأل عن اسم
    let desiredNote = oldNote;
    if (nextOn && maybePrompt){
      const v = promptForLabel(oldNote);
      if (v !== null) desiredNote = v; // null يعني cancel، نحتفظ بالقديم
    }

    // Optimistic UI
    applyUI(code, nextOn, desiredNote);

    try{
      // 1) جرّب حفظ بحقول Highlighted + Highlight Note
      const ok = await persistHL_Sheet(code, !!nextOn, desiredNote);
      if (ok) return;

      // 2) فولباك: Comments tokens
      await persistHL_FallbackComments(code, !!nextOn, desiredNote);
    }catch(err){
      console.error('Highlight update failed:', err);
      // تراجع UI
      applyUI(code, oldOn, oldNote);
      alert('Failed to update highlight. Please try again.');
    }finally{
      // إعادة رسم الحالة من الكاش الحالي
      renderHLUI(code);
    }
  }

  async function editHighlightNote(code){
    if (!isHighlighted(code)){
      // لو مش مفعّل، فعّل مع اسم
      await toggleHighlight(code, true, true);
      return;
    }
    const current = getHighlightNote(code);
    const v = promptForLabel(current);
    if (v === null) return; // cancel
    // Optimistic UI
    applyUI(code, true, v);

    try{
      const ok = await persistHL_Sheet(code, true, v);
      if (!ok) await persistHL_FallbackComments(code, true, v);
    }catch(err){
      console.error('Edit note failed:', err);
      // ما نلغي الهايلايت، بس نرجّع الاسم القديم
      applyUI(code, true, current);
      alert('Failed to save highlight name. Please try again.');
    }finally{
      renderHLUI(code);
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
        user-select: none;
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

      /* Highlight note chip (shows only when there is a note) */
      .row-chip.pr-hl-note {
        background: color-mix(in oklab, var(--primary-2) 18%, transparent);
        border: 1px solid var(--border);
        font-weight: 600;
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

      // يسار-كليك: تبديل سريع
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const wantOn = !isHighlighted(code);
        // إذا تشغيل جديد، افتح prompt لاسم الهايلايت (اختياري)
        toggleHighlight(code, wantOn, wantOn);
      });

      // دوبل-كليك أو كليك يمين: تعديل الاسم
      btn.addEventListener('dblclick', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        editHighlightNote(code);
      });
      btn.addEventListener('contextmenu', (e)=>{
        e.preventDefault();
        e.stopPropagation();
        editHighlightNote(code);
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
