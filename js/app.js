// js/app.js
// Palliative Rounds — App Orchestrator
// + Bulk ops in main list (select/move/delete)
// + Export Patient List with print scaling (scale/font/fit-one) and custom columns
// + Robust write-through for text fields

import { Sheets } from './sheets.js';
import { Patients } from './patients.js';
import { ESAS } from './esas.js';
import { CTCAE } from './ctcae.js';
import { Labs } from './labs.js';
import { Dashboard } from './dashboard.js';
import { Importer } from './importer.js';
import { UI } from './ui.js';
import { Utils } from './utils.js';
import { AIModule } from './ai.js';
import { Symptoms } from './symptoms.js';
import { Summaries } from './summaries.js';
import { Calculators } from './calculators.js';

// ===== Defaults on first run =====
const DEFAULTS = {
  spreadsheetId: '1l8UoblxznwV_zz7ZqnorOWZKfnmG3pZgVCT0DaSm0kU',
  bridgeUrl: 'https://script.google.com/macros/s/AKfycbxjiRgEeKlRbJQz_NZ0YhE0RSubMNLhi-Ndzk1PUCm0cW1ZJgIfqZc7bWiDlXd6wA8/exec'
};
(function ensureDefaults(){
  if (!localStorage.getItem('pr.sheet'))  localStorage.setItem('pr.sheet',  DEFAULTS.spreadsheetId);
  if (!localStorage.getItem('pr.bridge')) localStorage.setItem('pr.bridge', DEFAULTS.bridgeUrl);
  // NEW: default motion speed (CSS multiplier)
  if (!localStorage.getItem('pr.motion')) localStorage.setItem('pr.motion', '1');
})();

// ===== Helpers =====
function toRoomKey(v){
  const s = String(v || '').trim();
  if (!s) return {num: Number.POSITIVE_INFINITY, raw: ''};
  const m = s.match(/\d+/);
  const num = m ? parseInt(m[0], 10) : Number.NaN;
  return { num: Number.isNaN(num) ? Number.POSITIVE_INFINITY : num, raw: s.toLowerCase() };
}
const q  = (sel, root=document)=>root.querySelector(sel);
const qa = (sel, root=document)=>Array.from(root.querySelectorAll(sel));
const toast = (msg, type='info') => UI.toast(msg, type);

// Apply motion speed from localStorage to CSS var
function applyMotionSpeedFromStorage(){
  const v = localStorage.getItem('pr.motion') || '1';
  document.documentElement.style.setProperty('--motion-multiplier', v);
}

// ===== Preferences (from ThemeManager / localStorage.pr.settings) =====
function getPreferences(){
  // ThemeManager معرف عالميًا من themes.js
  const s = (window.ThemeManager && typeof window.ThemeManager.getSettings === 'function')
    ? window.ThemeManager.getSettings()
    : { cardDensity:'expanded', sectionOrder:[], modalColor:'auto' };
  return s || { cardDensity:'expanded', sectionOrder:[], modalColor:'auto' };
}
function applyDensityPref(s){
  try{
    const dens = s.cardDensity === 'compact' ? 'compact' : 'expanded';
    document.body.setAttribute('data-density', dens);
  }catch{ /* noop */ }
}
function applySectionOrderPref(s){
  if (!Array.isArray(s.sectionOrder) || !s.sectionOrder.length) return;
  const existing = Array.isArray(State.sections) ? State.sections.slice() : ['Default'];
  const orderSet = new Set(s.sectionOrder);
  const ordered = s.sectionOrder.filter(x => existing.includes(x));
  const extras  = existing.filter(x => !orderSet.has(x));
  State.sections = [...ordered, ...extras];
  if (!State.sections.includes(State.activeSection)) {
    State.activeSection = State.sections[0] || 'Default';
  }
}
function applyPreferencesToStateAndUI(){
  const s = getPreferences();
  applyDensityPref(s);
  applySectionOrderPref(s);
  // بعد تعديل ترتيب الأقسام لازم نعيد رسم الواجهة ذات الصلة
  renderSections();
  renderPatientsList();
  populateMoveTargets();
}
// استمع لحفظ التفضيلات من themes.js
window.addEventListener('pr:preferences-save', (ev)=>{
  const s = ev?.detail || getPreferences();
  applyDensityPref(s);
  applySectionOrderPref(s);
  renderSections();
  renderPatientsList();
  populateMoveTargets();
});

// Labs helpers (unchanged)
const LAB_REF = {
  'WBC':[4.0,11.0],'HGB':[12.0,16.0],'PLT':[150,450],'ANC':[1.5,8.0],'CRP':[0,5],
  'Albumin':[3.5,5.0],'Sodium (Na)':[135,145],'Potassium (K)':[3.5,5.1],'Chloride (Cl)':[98,107],
  'Calcium (Ca)':[8.5,10.5],'Phosphorus (Ph)':[2.5,4.5],'Alkaline Phosphatase (ALP)':[44,147],
  'Creatinine (Scr)':[0.6,1.3],'BUN':[7,20],'Total Bile':[0.1,1.2]
};
const parseNum = v => {
  if (v==null) return null;
  if (typeof v==='number') return Number.isFinite(v)?v:null;
  const m = String(v).trim().match(/-?\d+(\.\d+)?/); if(!m) return null;
  const n = parseFloat(m[0]); return Number.isNaN(n)?null:n;
};
const short = k => k.replace('Alkaline Phosphatase (ALP)','ALP')
  .replace('Creatinine (Scr)','Scr').replace('Sodium (Na)','Na')
  .replace('Potassium (K)','K').replace('Chloride (Cl)','Cl')
  .replace('Calcium (Ca)','Ca').replace('Phosphorus (Ph)','Ph');
function abnormalSummary(labs){
  if (!labs) return '';
  const arr=[];
  Object.keys(LAB_REF).forEach(k=>{
    const [lo,hi]=LAB_REF[k]; const n=parseNum(labs[k]);
    if (n==null) return;
    if (n<lo) arr.push(short(k)+'↓'); else if (n>hi) arr.push(short(k)+'↑');
  });
  return arr.join(', ');
}

// ===== Event Bus =====
const Bus = (()=>{ const m=new Map(); return {
  on(n,f){ if(!m.has(n)) m.set(n,new Set()); m.get(n).add(f); return ()=>m.get(n)?.delete(f); },
  emit(n,p){ m.get(n)?.forEach(fn=>{ try{fn(p);}catch(e){console.error('Bus',e);} }); }
};})();

// ===== Global State =====
const State = {
  ready:false, loading:false, filter:'all', search:'',
  activeSection:'Default', sections:['Default'],
  patients:[], esas:[], ctcae:[], labs:[],
  sel: new Set(), // selection in main list
  config:{
    spreadsheetId: localStorage.getItem('pr.sheet')||'',
    bridgeUrl: localStorage.getItem('pr.bridge')||'',
    useOAuth:false, aiEndpoint: localStorage.getItem('pr.ai')||''
  },
  get activePatient(){ return Patients.getActive?.()||null; }
};

// ===== UI: Sections & Patients list =====
function renderSections(){
  const root = q('#sections-list');
  if(!root) return;
  root.innerHTML = '';

  // احسب عدد المرضى بكل قسم
  const counts = {};
  State.patients.forEach(p => {
    const sec = p.Section || 'Default';
    counts[sec] = (counts[sec] || 0) + 1;
  });

  State.sections.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'pill ' + (name === State.activeSection ? 'active' : '');
    btn.innerHTML = `
      <span>${name}</span>
      <span class="pill-count ${counts[name] ? 'pulse' : ''}">${counts[name] || 0}</span>
    `;
    btn.addEventListener('click', () => {
      State.activeSection = name;
      const label = q('#active-section-name');
      if (label) label.textContent = name;
      State.sel.clear();
      renderPatientsList();
      Dashboard.clearEmpty?.(true);
      populateMoveTargets();
    });
    root.appendChild(btn);
  });

  const label = q('#active-section-name');
  if (label) label.textContent = State.activeSection || 'Default';
  populateMoveTargets();
}

// تحديث عدّاد الأقسام
function refreshSections(){
  renderSections();
}

function symptomsPreview(p){
  const s=(p['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean);
  return s.length? s.slice(0,3).join(', ')+(s.length>3?` (+${s.length-3})`:'') : '';
}
function getFilteredPatients(){
  const s=State.search.toLowerCase().trim(), f=State.filter;
  const inSec=p=>(p.Section||'Default')===State.activeSection;
  const txt=p=>!s||JSON.stringify(p).toLowerCase().includes(s);
  const st =p=> f==='all'?true : (f==='done'? !!p['Done'] : !p['Done']);
  return State.patients.filter(p=>inSec(p)&&txt(p)&&st(p));
}
function renderPatientsList(){
  const list=q('#patients-list'); if(!list) return; list.innerHTML='';
  const items=getFilteredPatients();
  if (!items.length){
    const d=document.createElement('div'); d.className='empty small'; d.style.padding='16px'; d.textContent='No patients in this view.'; list.appendChild(d);
    return;
  }
  items.forEach(p=>{
    const labsRec = Labs.getForPatient(p['Patient Code'], State.labs);
    const labsAbn = p['Labs Abnormal'] || abnormalSummary(labsRec);
    const symPrev = symptomsPreview(p);

    const row=document.createElement('div'); row.className='row patient-card'; row.dataset.code=p['Patient Code']||'';
    const left=document.createElement('div');

    // Header: checkbox + name + status
    const header=document.createElement('div'); header.className='row-header';
    const headLeft=document.createElement('div'); headLeft.style.display='flex'; headLeft.style.alignItems='center'; headLeft.style.gap='8px';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'plist-cb';
    cb.checked = State.sel.has(p['Patient Code']);
    cb.addEventListener('change', ()=>{
      if (cb.checked) State.sel.add(p['Patient Code']);
      else State.sel.delete(p['Patient Code']);
      updateBulkBarState();
    });

    const name=document.createElement('div'); name.className='row-title linkish'; name.textContent=p['Patient Name']||'(Unnamed)';
    headLeft.appendChild(cb); headLeft.appendChild(name);

    const badge=document.createElement('span'); badge.className = 'status ' + (p['Done']?'done':'open'); badge.textContent=p['Done']?'Done':'Open';
    header.appendChild(headLeft); header.appendChild(badge);

    const meta=document.createElement('div'); meta.className='row-sub';
    const dx=p['Diagnosis']?`• ${p['Diagnosis']}`:''; meta.textContent=`${p['Patient Age']||'—'} yrs • Room ${p['Room']||'—'} ${dx}`;

    const tags=document.createElement('div'); tags.className='row-tags';
    const sectionPill=document.createElement('span'); sectionPill.className='row-tag'; sectionPill.textContent=p['Section']||'Default'; tags.appendChild(sectionPill);
    if (labsAbn){ const chip=document.createElement('span'); chip.className='row-chip abn'; chip.textContent=labsAbn; tags.appendChild(chip); }
    if (symPrev){ const chip=document.createElement('span'); chip.className='row-chip sym'; chip.textContent=symPrev; tags.appendChild(chip); }

    left.appendChild(header); left.appendChild(meta); left.appendChild(tags);

    // === Mini calculator chips inside each patient card (ECOG / PPI / PPS) ===
    const mini = document.createElement('div');
    mini.className = 'mini-actions';
    function makeChip(label, type) {
      const b = document.createElement('button');
      b.className = 'btn-chip';
      b.dataset.calc = type;
      b.dataset.code = p['Patient Code'] || '';
      b.textContent = label;
      return b;
    }
    mini.appendChild(makeChip('ECOG', 'ecog'));
    mini.appendChild(makeChip('PPI',  'ppi'));
    mini.appendChild(makeChip('PPS',  'pps'));
    left.appendChild(mini);
    // === /mini chips ===

    const right=document.createElement('div'); right.innerHTML='<span class="mono muted">'+(p['Patient Code']||'')+'</span>';

    row.appendChild(left); row.appendChild(right);

    // فتح المودال عند الضغط على الاسم
    name.addEventListener('click',(e)=>{
      e.stopPropagation();
      Patients.setActiveByCode?.(p['Patient Code']);
      openDashboardFor(p['Patient Code'], true);
    });

    list.appendChild(row);
  });
  updateBulkBarState();
}
function updateBulkBarState(){
  const has = State.sel.size>0;
  ['#plist-move','#plist-delete'].forEach(id=>{
    const b=q(id); if (b) b.disabled = !has;
  });
}

// ===== Populate move targets =====
function populateMoveTargets(){
  const sections = State.sections || ['Default'];
  const s1 = q('#plist-move-target'); if (s1){
    s1.innerHTML=''; sections.forEach(sec=>{ const o=document.createElement('option'); o.value=sec; o.textContent=sec; s1.appendChild(o); });
    s1.value = State.activeSection || sections[0];
  }
  const s2 = q('#export-move-target'); if (s2){
    s2.innerHTML=''; sections.forEach(sec=>{ const o=document.createElement('option'); o.value=sec; o.textContent=sec; s2.appendChild(o); });
    s2.value = State.activeSection || sections[0];
  }
}

// ===== Dashboard binding (write-through) =====
const PATIENT_FIELDS = new Set([
  'Patient Code','Patient Name','Patient Age','Room','Admitting Provider','Diagnosis','Diet','Isolation','Comments',
  'Section','Done','Updated At','HPI Diagnosis','HPI Previous','HPI Current','HPI Initial','Patient Assessment','Medication List','Latest Notes',
  'Symptoms','Symptoms Notes','Labs Abnormal'
]);
const FIELD_FALLBACK_BY_ID = {
  'hpi-diagnosis':      'HPI Diagnosis',
  'hpi-initial':        'HPI Initial',
  'hpi-previous':       'HPI Previous',
  'hpi-current':        'HPI Current',
  'patient-assessment': 'Patient Assessment',
  'medication-list':    'Medication List',
  'latest-notes':       'Latest Notes'
};
function normalizeLabelToField(labelText){
  if (!labelText) return '';
  const t = String(labelText).trim();
  if (/^cause of admission$/i.test(t)) return 'HPI Diagnosis';
  if (/^name$/i.test(t) || /^patient name$/i.test(t)) return 'Patient Name';
  if (/^age$/i.test(t)  || /^patient age$/i.test(t)) return 'Patient Age';
  if (/^room$/i.test(t)) return 'Room';
  if (/^diagnosis$/i.test(t)) return 'Diagnosis';
  if (/^admitting provider$/i.test(t)) return 'Admitting Provider';
  if (/^diet$/i.test(t)) return 'Diet';
  if (/^isolation$/i.test(t)) return 'Isolation';
  if (/^comments?$/i.test(t)) return 'Comments';
  if (PATIENT_FIELDS.has(t)) return t;
  return '';
}
function getElementValue(el){
  if (!el) return '';
  if (el.matches('[contenteditable="true"], [contenteditable=""]')) return el.textContent ?? '';
  if ('value' in el) return el.value ?? '';
  return el.textContent ?? '';
}
function ensureModalFieldBindings(modal){
  qa('input, textarea, select, [contenteditable="true"]', modal).forEach(el=>{
    if (el.dataset && el.dataset.bindField) return;
    let field = '';
    const wrapper = el.closest('.field') || el.closest('label.field');
    const lab = wrapper ? wrapper.querySelector('.label') : null;
    if (lab) field = normalizeLabelToField(lab.textContent);
    if (!field && el.getAttribute) {
      const nm = el.getAttribute('name'); const id = el.id;
      if (nm && PATIENT_FIELDS.has(nm)) field = nm;
      else if (id && FIELD_FALLBACK_BY_ID[id]) field = FIELD_FALLBACK_BY_ID[id];
      else if (id && PATIENT_FIELDS.has(id)) field = id;
    }
    if (field) el.dataset.bindField = field;
  });
}
let dashboardFieldBindingDone = false;
const debouncedWrites = new WeakMap();
function writeFieldDebounced(code, field, el){
  if (!debouncedWrites.has(el)) {
    debouncedWrites.set(el, Utils.debounce(async ()=>{
      const value = getElementValue(el).toString();
      try{
        await Sheets.writePatientField(code, field, value);
        const idx = State.patients.findIndex(p=>p['Patient Code']===code);
        if (idx>=0) State.patients[idx][field] = value;
      }catch(err){
        console.error(err);
        toast(`Failed to save ${field}.`, 'danger');
      }
    }, 350));
  }
  debouncedWrites.get(el)();
}
function bindDashboardFieldSyncOnce(){
  if (dashboardFieldBindingDone) return;
  dashboardFieldBindingDone = true;
  document.addEventListener('input', (e)=>{
    const modal = q('#patient-modal'); if (!modal || modal.classList.contains('hidden')) return;
    const t = e.target; if (!t) return;
    ensureModalFieldBindings(modal);
    let field = t.dataset && t.dataset.bindField;
    if (!field && t.id && FIELD_FALLBACK_BY_ID[t.id]) field = FIELD_FALLBACK_BY_ID[t.id];
    if (!field) return;
    const code = modal.dataset.code || (State.activePatient && State.activePatient['Patient Code']);
    if (!code) return;
    writeFieldDebounced(code, field, t);
  }, true);
  ['change','blur'].forEach(ev=>{
    document.addEventListener(ev, (e)=>{
      const modal = q('#patient-modal'); if (!modal || modal.classList.contains('hidden')) return;
      const t = e.target; if (!t) return;
      ensureModalFieldBindings(modal);
      let field = t.dataset && t.dataset.bindField;
      if (!field && t.id && FIELD_FALLBACK_BY_ID[t.id]) field = FIELD_FALLBACK_BY_ID[t.id];
      if (!field) return;
      const code = modal.dataset.code || (State.activePatient && State.activePatient['Patient Code']);
      if (!code) return;
      const value = getElementValue(t).toString();
      Sheets.writePatientField(code, field, value)
        .then(()=>{
          const idx = State.patients.findIndex(p=>p['Patient Code']===code);
          if (idx>=0) State.patients[idx][field] = value;
        })
        .catch(err=>{ console.error(err); toast(`Failed to save ${field}.`, 'danger'); });
    }, true);
  });
}
function openDashboardFor(code, asModal=false){
  const patient = State.patients.find(p=>p['Patient Code']===code);
  if (!patient) return;
  Patients.setActiveByCode?.(code);
  const pm = q('#patient-modal'); if (pm) pm.dataset.code = code;
  const t=q('#dashboard-title'); if (t) t.textContent=`Dashboard — ${patient['Patient Name']||code}`;
  const mt=q('#patient-modal-title'); if (mt) mt.textContent=patient['Patient Name']||code;
  Dashboard.bindPatient(patient, {
    esas: ESAS.getForPatient(code, State.esas),
    ctcae: CTCAE.getForPatient(code, State.ctcae),
    labs: Labs.getForPatient(code, State.labs)
  });
  const sData = {
    symptoms: (patient['Symptoms']||'').split(',').map(x=>x.trim()).filter(Boolean),
    notes: safeJSON(patient['Symptoms Notes']||'{}')
  };
  Symptoms.render(code, sData);
  const panel=q('#dashboard-panel'); if (panel) panel.dataset.empty='false';
  Sheets.writePatientField(code,'Updated At',new Date().toISOString()).catch(()=>{});
  bindDashboardFieldSyncOnce();
  if (pm) ensureModalFieldBindings(pm);
  if (asModal) openPatientModal();
}
const safeJSON = s => { try{return JSON.parse(s);}catch{return{};} };

// ===== Modal =====
function openPatientModal(){
  const m=q('#patient-modal'); if (!m) return;
  m.classList.remove('hidden');
  document.documentElement.style.overflow='hidden';
  const onKey=(ev)=>{ if(ev.key==='Escape'){ ev.preventDefault(); closePatientModal(); document.removeEventListener('keydown',onKey);} };
  document.addEventListener('keydown', onKey);
}
function closePatientModal(){
  const m=q('#patient-modal'); if (!m) return;
  m.classList.add('hidden');
  document.documentElement.style.overflow='';
}

// ===== Load from Sheets =====
async function loadAllFromSheets(){
  State.loading=true;
  try{
    await Sheets.init(State.config);
    const data=await Sheets.loadAll();
    State.sections = data.sections?.length ? data.sections : ['Default'];
    State.patients = Array.isArray(data.patients) ? data.patients : [];
    State.esas     = Array.isArray(data.esas)     ? data.esas     : [];
    State.ctcae    = Array.isArray(data.ctcae)    ? data.ctcae    : [];
    State.labs     = Array.isArray(data.labs)     ? data.labs     : [];
    if (!data.sections?.length) await Sheets.ensureSection('Default');
    if (!State.sections.includes(State.activeSection)) State.activeSection = State.sections[0] || 'Default';

    // === Apply preferences after pulling sections from Sheets ===
    const prefs = getPreferences();
    applyDensityPref(prefs);
    applySectionOrderPref(prefs);

    renderSections();
    renderPatientsList();
    Dashboard.clearEmpty?.(true);
  }catch(e){
    console.error(e);
    toast('Failed to load from Google Sheets. Check Settings.','danger');
  }finally{
    State.loading=false;
  }
}

// ===== Mobile UI (sidebar toggle + scrim + FAB) =====
function setupMobileUI(){
  if (window.__mobileSetupDone) return;         // قفل لمنع التكرار
  window.__mobileSetupDone = true;

  const topbar = q('#topbar');

  // زر الهامبرغر (يُحقن تلقائياً ولا يحتاج تعديل في index.html)
  if (topbar && !q('#btn-toggle-sidebar', topbar)) {
    const btn = document.createElement('button');
    btn.id = 'btn-toggle-sidebar';
    btn.className = 'icon-btn mobile-only';
    btn.setAttribute('aria-label','Menu');
    btn.innerHTML = '☰';
    topbar.insertBefore(btn, topbar.firstChild);
  }

  // Scrim للخلفية عند فتح السايدبار
  if (!q('#sidebar-scrim')) {
    const s = document.createElement('div');
    s.id = 'sidebar-scrim';
    s.className = 'scrim';
    document.body.appendChild(s);
  }

  const open  = ()=> document.body.classList.add('sidebar-open');
  const close = ()=> document.body.classList.remove('sidebar-open');
  const toggle= ()=> document.body.classList.toggle('sidebar-open');

  q('#btn-toggle-sidebar')?.addEventListener('click', toggle);
  q('#sidebar-scrim')?.addEventListener('click', close);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') close(); });

  // إغلاق السايدبار بعد اختيار قسم
  document.addEventListener('click', e=>{
    if (!document.body.classList.contains('sidebar-open')) return;
    if (e.target.closest('#sections-list .pill')) close();
  });

  // عند الرجوع لديسكتوب (>980px) أغلق السايدبار
  const mq = window.matchMedia('(min-width: 981px)');
  const onChange = ()=>{ if (mq.matches) close(); };
  mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
  onChange();

  // FAB = نفس زر + New Patient
  q('#fab-add')?.addEventListener('click', ()=>{
    q('#btn-new-patient')?.click();
  });
}

// ===== Bind UI =====
function bindUI(){
  UI.init?.(Bus);

  // Tabs
  qa('.tabs .tab').forEach(t=>{
    t.addEventListener('click', ()=>{
      qa('.tabs .tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      State.filter = t.dataset.filter || 'all';
      State.sel.clear();
      renderPatientsList();
      updateBulkBarState();
    });
  });
  
  // Calculators open buttons
  q('#open-ecog')?.addEventListener('click', () => Calculators.openECOG());
  q('#open-opioid')?.addEventListener('click', () => Calculators.openOpioid());
  q('#open-ppi')?.addEventListener('click', () => Calculators.openPPI());
  q('#open-pps')?.addEventListener('click', () => Calculators.openPPS());

  // Launch per-patient calculators from card chips (lightweight)
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-chip[data-calc]');
    if (!btn) return;

    const code = btn.dataset.code || '';
    if (code) {
      // ثبّت المريض النشط
      Patients.setActiveByCode?.(code);
      const pm = q('#patient-modal');
      if (pm) pm.dataset.code = code;
    }

    const type = btn.dataset.calc;
    if (type === 'ecog') return Calculators.openECOG();
    if (type === 'ppi')  return Calculators.openPPI();
    if (type === 'pps')  return Calculators.openPPS();
  });

  // Search
  const s=q('#search');
  if (s) s.addEventListener('input', Utils.debounce(e=>{
    State.search = e.target.value || '';
    renderPatientsList();
  }, 200));

  // Sections CRUD
  q('#btn-add-section')?.addEventListener('click', async ()=>{
    const name=prompt('New section name')||''; if(!name.trim()) return;
    if (State.sections.includes(name)) return toast('Section name already exists.','warn');
    try{
      await Sheets.createSection(name);
      State.sections.push(name); State.activeSection=name;
      renderSections(); renderPatientsList(); toast('Section created.','success');
    }catch{ toast('Failed to create section in Sheets.','danger'); }
  });

  q('#btn-rename-section')?.addEventListener('click', async ()=>{
    const oldName=State.activeSection; if(!oldName) return;
    const newName=prompt('Rename section:', oldName)||''; if(!newName.trim()||newName===oldName) return;
    if (State.sections.includes(newName)) return toast('Section name already exists.','warn');
    try{
      await Sheets.renameSection(oldName, newName);
      State.patients.forEach(p=>{ if((p.Section||'Default')===oldName) p.Section=newName; });
      State.sections = State.sections.map(s=>s===oldName?newName:s);
      State.activeSection=newName;
      renderSections(); renderPatientsList(); toast('Section renamed.','success');
    }catch{ toast('Failed to rename section.','danger'); }
  });

  q('#btn-delete-section')?.addEventListener('click', async ()=>{
    const current=State.activeSection; if(!current) return;
    if (State.sections.length<=1){ alert('Cannot delete the last section.'); return; }
    if (!confirm(`Delete section “${current}”? Patients will be moved to “Default”.`)) return;
    try{
      if (!State.sections.includes('Default')){ await Sheets.createSection('Default'); State.sections.push('Default'); }
      const list=State.patients.filter(p=>(p.Section||'Default')===current);
      for (const p of list){ p.Section='Default'; await Sheets.writePatientField(p['Patient Code'],'Section','Default').catch(()=>{}); }
      await Sheets.deleteSection(current);
      State.sections = State.sections.filter(s=>s!==current);
      State.activeSection = State.sections[0] || 'Default';
      renderSections(); renderPatientsList(); Dashboard.clearEmpty?.(true);
      toast('Section deleted and patients moved to “Default”.','success');
    }catch{ toast('Failed to delete section.','danger'); }
  });
  
  // New patient
  q('#btn-new-patient')?.addEventListener('click', async ()=>{
    try{
      const p = {
        'Patient Code':'P'+Math.random().toString(36).slice(2,8).toUpperCase(),
        'Patient Name':'','Patient Age':'','Room':'','Admitting Provider':'','Diagnosis':'','Diet':'','Isolation':'','Comments':'',
        'Section':State.activeSection,'Done':false,'Updated At':new Date().toISOString(),
        'HPI Diagnosis':'','HPI Previous':'','HPI Current':'','HPI Initial':'',
        'Patient Assessment':'','Medication List':'','Latest Notes':'',
        'Symptoms':'','Symptoms Notes':'{}','Labs Abnormal':''
      };
      await Sheets.insertPatient(p);
      State.patients.unshift(p);
      renderPatientsList();
      Patients.setActiveByCode?.(p['Patient Code']);
      openDashboardFor(p['Patient Code'], true);
      toast('Patient created.','success');
      refreshSections();
    }catch{ toast('Failed to create patient in Sheets.','danger'); }
  });

  // Import
  q('#btn-import')?.addEventListener('click', ()=>{
    q('#csv-preview').innerHTML=''; q('#csv-file-input').value='';
    q('#import-modal')?.classList.remove('hidden');
    q('#btn-import-confirm').onclick = async ()=>{
      const rows = Importer.consumeValidatedRows?.() || [];
      if (!rows.length){ alert('No rows to import.'); return; }
      const objs = rows.map(r=>({
        'Patient Code': r[0] || ('P'+Math.random().toString(36).slice(2,8).toUpperCase()),
        'Patient Name': r[1]||'','Patient Age': r[2]||'','Room': r[3]||'','Diagnosis': r[4]||'',
        'Section': r[5]||State.activeSection,'Admitting Provider': r[6]||'','Diet': r[7]||'','Isolation': r[8]||'','Comments': r[9]||'',
        'Symptoms': r[10]||'','Symptoms Notes': r[11]||'{}','Labs Abnormal': r[12]||'',
        'Done':false,'Updated At':new Date().toISOString(),
        'HPI Diagnosis':'','HPI Previous':'','HPI Current':'','HPI Initial':'','Patient Assessment':'','Medication List':'','Latest Notes':''
      }));
      try{
        await Sheets.bulkInsertPatients(objs);
        State.patients.push(...objs);
        renderPatientsList();
        q('[data-close-modal="import-modal"]')?.click();
        toast(`Imported ${objs.length} patients.`, 'success');
        refreshSections();
      }catch{ toast('Import failed. Check CSV order/format.', 'danger'); }
    };
  });

  // Export template
  q('#btn-export-template')?.addEventListener('click', ()=>{
    const headers=[
      'Patient Code','Patient Name','Patient Age','Room','Diagnosis','Section',
      'Admitting Provider','Diet','Isolation','Comments',
      'Symptoms (comma-separated)','Symptoms Notes (JSON map)','Labs Abnormal (comma-separated)'
    ];
    const csv=headers.join(',')+'\n';
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download='palliative_rounds_template.csv'; a.click(); URL.revokeObjectURL(a.href);
    toast('Template downloaded.','success');
  });

  // Delete all patients in section
  q('#btn-delete-all-pats')?.addEventListener('click', async ()=>{
    const sec=State.activeSection; if(!sec) return;
    const list=State.patients.filter(p=>(p.Section||'Default')===sec);
    if (!list.length){ toast('No patients in this section.','warn'); return; }
    if (!confirm(`Delete ALL ${list.length} patients in section “${sec}”? This cannot be undone.`)) return;
    try{
      const codes=list.map(p=>p['Patient Code']);
      State.patients = State.patients.filter(p=>(p.Section||'Default')!==sec);
      State.esas     = State.esas.filter(r=>!codes.includes(r['Patient Code']));
      State.ctcae    = State.ctcae.filter(r=>!codes.includes(r['Patient Code']));
      State.labs     = State.labs.filter(r=>!codes.includes(r['Patient Code']));
      renderPatientsList();
      const didBulk = await Sheets.deletePatientsInSection?.(sec);
      if (!didBulk) await Sheets.bulkDeletePatients?.(codes);
      toast(`Deleted ${list.length} patients in “${sec}”.`, 'success');
      refreshSections();
    }catch{ toast('Failed to delete all patients from Sheets.', 'danger'); }
  });

  // Refresh
  q('#btn-refresh')?.addEventListener('click', async ()=>{ await loadAllFromSheets(); toast('Data refreshed.','success'); });

  // Close modals
  qa('[data-close-modal]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id=btn.getAttribute('data-close-modal'); if(!id) return;
      q('#'+id)?.classList.add('hidden');
      if (id==='patient-modal') document.documentElement.style.overflow='';
    });
  });
  
  // زر All Summaries
  q('#open-summaries')?.addEventListener('click', () => {
    Summaries.open();
  });
  
  // Settings open via delegation
  document.addEventListener('click', (e)=>{
    const t=e.target.closest('#open-settings'); if(!t) return;
    e.preventDefault();
    q('#set-spreadsheet-id').value = State.config.spreadsheetId;
    q('#set-bridge-url').value     = State.config.bridgeUrl;
    q('#set-ai-endpoint').value    = State.config.aiEndpoint;
    // NEW: set current motion value into the select
    const motion = localStorage.getItem('pr.motion') || '1';
    const sel = q('#set-motion-speed');
    if (sel) sel.value = motion;
    q('#settings-modal')?.classList.remove('hidden');
  });

  // Save settings
  q('#btn-settings-save')?.addEventListener('click', async ()=>{
    State.config.spreadsheetId = q('#set-spreadsheet-id').value.trim();
    State.config.bridgeUrl     = q('#set-bridge-url').value.trim();
    State.config.aiEndpoint    = q('#set-ai-endpoint').value.trim();

    // NEW: motion speed
    const motionVal = (q('#set-motion-speed')?.value || '1').trim() || '1';
    localStorage.setItem('pr.motion', motionVal);
    document.documentElement.style.setProperty('--motion-multiplier', motionVal);

    localStorage.setItem('pr.sheet',  State.config.spreadsheetId);
    localStorage.setItem('pr.bridge', State.config.bridgeUrl);
    localStorage.setItem('pr.ai',     State.config.aiEndpoint);
    q('#settings-modal')?.classList.add('hidden');

    setupMobileUI();               // تأكد من تفعيل الموبايل بعد أي تعديل
    await loadAllFromSheets();
    toast('Settings saved. Reconnected.','success');
  });

  // Delete patient (single) inside patient modal
  document.addEventListener('click', async (e)=>{
    const btn=e.target.closest('#btn-delete-patient'); if(!btn) return;
    const modal=q('#patient-modal'); const code=modal?.dataset.code;
    let p = code ? State.patients.find(x=>x['Patient Code']===code) : State.activePatient;
    if (!p){ toast('Select a patient first.','warn'); return; }
    if (!confirm(`Delete patient “${p['Patient Name']||p['Patient Code']}”?`)) return;
    try{
      await Sheets.deletePatient(p['Patient Code']);
      const theCode=p['Patient Code'];
      State.patients = State.patients.filter(x=>x['Patient Code']!==theCode);
      State.esas     = State.esas.filter(x=>x['Patient Code']!==theCode);
      State.ctcae    = State.ctcae.filter(x=>x['Patient Code']!==theCode);
      State.labs     = State.labs.filter(x=>x['Patient Code']!==theCode);
      State.sel.delete(theCode);
      renderPatientsList(); Dashboard.clearEmpty?.(true); closePatientModal();
      toast('Patient deleted.','success');
      refreshSections();
    }catch{ toast('Failed to delete patient.', 'danger'); }
  });

  // Mark done
  q('#btn-mark-done')?.addEventListener('click', async ()=>{
    const modal=q('#patient-modal'); const code=modal?.dataset.code;
    const p = code ? State.patients.find(x=>x['Patient Code']===code) : State.activePatient;
    if (!p) return toast('Select a patient first.','warn');
    const newVal = !(p['Done']===true);
    try{
      p['Done']=newVal;
      await Sheets.writePatientField(p['Patient Code'],'Done', newVal?'TRUE':'FALSE');
      renderPatientsList();
      toast(newVal?'Marked as Done.':'Marked as Open.','success');
    }catch{ toast('Failed to update Done in Sheets.','danger'); }
  });

  // ===== Main list bulk actions =====
  q('#plist-select-all')?.addEventListener('click', ()=>{
    getFilteredPatients().forEach(p=>State.sel.add(p['Patient Code']));
    renderPatientsList();
    updateBulkBarState();
  });
  q('#plist-clear')?.addEventListener('click', ()=>{
    State.sel.clear();
    renderPatientsList();
    updateBulkBarState();
  });
  q('#plist-move')?.addEventListener('click', async ()=>{
    const target = q('#plist-move-target')?.value || 'Default';
    const codes = Array.from(State.sel.values());
    if (!codes.length) return toast('No patients selected.','warn');
    if (!target) return;
    try{
      for (const code of codes){
        await Sheets.writePatientField(code, 'Section', target);
        const i = State.patients.findIndex(p=>p['Patient Code']===code);
        if (i>=0) State.patients[i].Section = target;
      }
      State.sel.clear();
      renderPatientsList();
      populateMoveTargets();
      toast(`Moved ${codes.length} patients to "${target}".`, 'success');
      refreshSections();
    }catch(e){ console.error(e); toast('Failed to move selected patients.','danger'); }
  });
  q('#plist-delete')?.addEventListener('click', async ()=>{
    const codes = Array.from(State.sel.values());
    if (!codes.length) return toast('No patients selected.','warn');
    if (!confirm(`Delete ${codes.length} selected patients? This cannot be undone.`)) return;
    try{
      await Sheets.bulkDeletePatients(codes);
      State.patients = State.patients.filter(p=>!codes.includes(p['Patient Code']));
      State.esas     = State.esas.filter(r=>!codes.includes(r['Patient Code']));
      State.ctcae    = State.ctcae.filter(r=>!codes.includes(r['Patient Code']));
      State.labs     = State.labs.filter(r=>!codes.includes(r['Patient Code']));
      State.sel.clear();
      renderPatientsList();
      toast('Selected patients deleted.','success');
      refreshSections();
    }catch(e){ console.error(e); toast('Failed to delete selected patients.','danger'); }
  });

  // Symptoms write-through
  Bus.on('symptoms.changed', async ({ code, symptoms, notes })=>{
    try{
      const s=(symptoms||[]).join(', ');
      const n=JSON.stringify(notes||{});
      await Sheets.writePatientFields?.(code, { 'Symptoms':s, 'Symptoms Notes':n });
      const idx=State.patients.findIndex(p=>p['Patient Code']===code);
      if (idx>=0){ State.patients[idx]['Symptoms']=s; State.patients[idx]['Symptoms Notes']=n; }
      renderPatientsList(); toast('Symptoms updated.','success');
    }catch{ toast('Failed to sync symptoms.','danger'); }
  });
  
  // Append calculator text to patient's Latest Notes (always append; never replace)
  Bus.on('calc.appendToHPI', async ({ code, text }) => {
    try{
      const idx = State.patients.findIndex(p => p['Patient Code'] === code);
      if (idx < 0) return toast('No active patient.', 'warn');

      const current = State.patients[idx]['Latest Notes'] || '';
      const sep = current && !/\n$/.test(current) ? '\n' : '';
      const newVal = current + sep + text;

      await Sheets.writePatientField(code, 'Latest Notes', newVal);
      State.patients[idx]['Latest Notes'] = newVal;

      toast('Added to Latest Notes.', 'success');
    }catch(e){ console.error(e); toast('Failed to add to Latest Notes.', 'danger'); }
  });

  // Labs write-through
  Bus.on('labs.changed', async ({ code, record })=>{
    try{ await Sheets.writeLabs(code, record); Labs.upsertLocal?.(State.labs, record); toast('Synced','success'); }
    catch{ toast('Failed to sync Labs.','danger'); }
  });
}

// ===== Export Patient List (modal, selection, bulk ops, print) =====
function openExportModal(){
  const modal = q('#export-modal');
  if (!modal) { toast('Export modal not found.', 'danger'); return; }
  populateMoveTargets();
  renderExportList();
  modal.classList.remove('hidden');
  document.documentElement.style.overflow='hidden';
}
function closeExportModal(){
  const modal = q('#export-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.documentElement.style.overflow='';
}

// Internal selection model for export modal
const ExportSel = new Set();
function getPatientsForExportFiltered(){
  const term = (q('#export-search')?.value || '').toLowerCase().trim();
  const arr = State.patients.slice();
  if (!term) return arr;
  return arr.filter(p => JSON.stringify(p).toLowerCase().includes(term));
}
function renderExportList(){
  const root = q('#export-list'); if (!root) return;
  root.innerHTML = '';
  const pats = getPatientsForExportFiltered();
  const bySec = new Map();
  pats.forEach(p=>{
    const sec = p.Section || 'Default';
    if (!bySec.has(sec)) bySec.set(sec, []);
    bySec.get(sec).push(p);
  });
  const secs = Array.from(bySec.keys()).sort((a,b)=> a.localeCompare(b));
  secs.forEach(sec=>{
    const list = bySec.get(sec) || [];
    list.sort((a,b)=>{
      const ka = toRoomKey(a.Room);
      const kb = toRoomKey(b.Room);
      if (ka.num !== kb.num) return ka.num - kb.num;
      return ka.raw.localeCompare(kb.raw);
    });
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML = '<div class="card-title">Section: '+sec+'</div>';
    card.appendChild(head);
    const table = document.createElement('table');
    table.className = 'mono small';
    table.style.width='100%';
    table.style.borderCollapse='collapse';
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    // ملاحظة: جدول المعاينة داخل المودال لم نغيره (Diet موجود) لأنك طلبت التغيير للطباعة فقط.
    ['Select','Patient Code','Patient Name','Patient Age','Room','Admitting Provider','Cause Of Admission','Diet','Isolation','Note'].forEach(h=>{
      const th = document.createElement('th');
      th.textContent = h;
      th.style.textAlign = 'left';
      th.style.border = '1px solid var(--border)';
      th.style.padding = '6px 8px';
      th.style.background = 'rgba(124,156,255,.10)';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    list.forEach(p=>{
      const tr = document.createElement('tr');
      const cells = [
        '__select__',
        p['Patient Code']||'',
        p['Patient Name']||'',
        p['Patient Age']||'',
        p['Room']||'',
        p['Admitting Provider']||'',
        p['Diagnosis']||'',
        p['Diet']||'',
        p['Isolation']||'',
        p['Comments']||''
      ];
      cells.forEach((val, idx)=>{
        const td = document.createElement('td');
        td.style.border = '1px solid var(--border)';
        td.style.padding = '6px 8px';
        if (idx===0){
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.code = p['Patient Code']||'';
          cb.checked = ExportSel.has(cb.dataset.code);
          cb.addEventListener('change', ()=>{
            if (cb.checked) ExportSel.add(cb.dataset.code);
            else ExportSel.delete(cb.dataset.code);
          });
          td.appendChild(cb);
        } else {
          td.textContent = val;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    root.appendChild(card);
  });
  if (!secs.length){
    const d = document.createElement('div');
    d.className='muted small';
    d.textContent='No patients match the current search.';
    root.appendChild(d);
  }
}

// ===== Print builder with scaling options (custom columns) =====
function escapeHTML(s){ return String(s).replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function ageYearsOnly(v){
  if (v==null) return '';
  const m = String(v).match(/\d+/);
  return m ? m[0] : String(v);
}
function firstWord(s){
  const t = String(s||'').trim();
  if (!t) return '';
  const m = t.match(/^\S+/);
  return m ? m[0] : t;
}

function buildPrintPagesHTML(selectedCodes, options){
  const { scalePercent=100, fontPx=12, fitOne=false } = options||{};
  const usingSelected = selectedCodes && selectedCodes.length>0;
  const pats = usingSelected
    ? State.patients.filter(p=>selectedCodes.includes(p['Patient Code']))
    : getPatientsForExportFiltered();

  // group by section
  const bySec = new Map();
  pats.forEach(p=>{
    const sec=p.Section||'Default';
    if (!bySec.has(sec)) bySec.set(sec, []);
    bySec.get(sec).push(p);
  });

  const sections = Array.from(bySec.keys()).sort((a,b)=> a.localeCompare(b));
  const A4_CONTENT_HEIGHT_PX = 1030; // تقريب
  const HEAD_EST = 60;
  const ROW_EST_FACTOR = 2.2;

  const pages = sections.map(sec=>{
    const list = bySec.get(sec);
    list.sort((a,b)=>{
      const ka = toRoomKey(a.Room);
      const kb = toRoomKey(b.Room);
      if (ka.num !== kb.num) return ka.num - kb.num;
      return ka.raw.localeCompare(kb.raw);
    });

    // fit-one estimation
    let effectiveScale = scalePercent / 100;
    if (fitOne){
      const estHeight = HEAD_EST + (list.length * fontPx * ROW_EST_FACTOR);
      const needed = A4_CONTENT_HEIGHT_PX / estHeight;
      if (needed < effectiveScale) effectiveScale = Math.max(0.5, needed);
    }

    // Build rows with transformed fields:
    const rows = list.map(p=>{
      const code   = escapeHTML(p['Patient Code']||'');
      const name   = escapeHTML(p['Patient Name']||'');
      const age    = escapeHTML(ageYearsOnly(p['Patient Age']||''));
      const room   = escapeHTML(p['Room']||'');
      const prov   = escapeHTML(firstWord(p['Admitting Provider']||'')); // first token only
      const cause  = escapeHTML(p['Diagnosis']||'');
      const iso    = String(p['Isolation']||'').trim();
      const note   = escapeHTML(p['Comments']||'');

      const isoLower = iso.toLowerCase();
      const isoCellStyle = (iso && isoLower !== 'standard')
        ? ' style="background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact;"'
        : '';

      return `<tr>
        <td>${code}</td>
        <td>${name}</td>
        <td>${age}</td>
        <td>${room}</td>
        <td>${prov}</td>
        <td>${cause}</td>
        <td${isoCellStyle}>${escapeHTML(iso)}</td>
        <td>${note}</td>
      </tr>`;
    }).join('');

    const colgroup = `
      <colgroup>
        <col style="width:10%">
        <col style="width:18%">
        <col style="width:6%">
        <col style="width:8%">
        <col style="width:10%">
        <col style="width:18%">
        <col style="width:10%">
        <col style="width:20%">
      </colgroup>`;

    const table = `
      <div class="print-page">
        <div class="print-scale" style="transform:scale(${effectiveScale}); transform-origin: top left; width:${(100/ effectiveScale).toFixed(2)}%; ">
          <div class="print-head" style="margin-bottom:8px">
            <div class="print-title">Patient List — Section: ${escapeHTML(sec)}</div>
            <div class="print-sub">Generated: ${Utils.formatDateTime(new Date().toISOString())}</div>
          </div>
          <table class="print-table" style="font-size:${fontPx}px">
            ${colgroup}
            <thead>
              <tr>
                <th>Patient Code</th>
                <th>Patient Name</th>
                <th>Age</th>
                <th>Room</th>
                <th>Admitting Provider</th>
                <th>Cause Of Admission</th>
                <th>Isolation</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="8">No patients</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;

    return table;
  });

  return pages.join('\n');
}

function renderPrintRootAndPrint(){
  const root = q('#print-root'); if (!root) { toast('Print root missing.','danger'); return; }
  const selected = Array.from(ExportSel.values());
  const scale = Math.max(50, Math.min(100, parseInt(q('#export-scale')?.value || '100', 10) || 100));
  const fontPx = parseInt(q('#export-font')?.value || '12', 10) || 12;
  const fitOne = !!q('#export-fit-one')?.checked;
  root.innerHTML = buildPrintPagesHTML(selected, { scalePercent: scale, fontPx, fitOne });
  root.style.display = '';
  document.body.setAttribute('data-printing','true');
  window.print();
  setTimeout(()=>{
    document.body.removeAttribute('data-printing');
    root.style.display='none';
  }, 500);
}

// Wire modal buttons for export
document.addEventListener('click', async (e)=>{
  if (e.target.closest('#btn-export-patient-list')) { e.preventDefault(); openExportModal(); }
  const inModal = e.target.closest('#export-modal'); 
  if (!inModal) return;
  if (e.target.closest('#btn-export-select-all')){
    getPatientsForExportFiltered().forEach(p=> ExportSel.add(p['Patient Code']));
    renderExportList();
  }
  if (e.target.closest('#btn-export-clear')){
    ExportSel.clear();
    renderExportList();
  }
  if (e.target.closest('#btn-export-move')){
    const target = q('#export-move-target')?.value || 'Default';
    const codes = Array.from(ExportSel.values());
    if (!codes.length) { toast('No patients selected.','warn'); return; }
    for (const code of codes){
      await Sheets.writePatientField(code,'Section', target);
      const i = State.patients.findIndex(p=>p['Patient Code']===code);
      if (i>=0) State.patients[i].Section = target;
    }
    renderPatientsList();
    renderExportList();
    toast(`Moved ${codes.length} patients to "${target}".`,'success');
    refreshSections();
  }
  if (e.target.closest('#btn-export-delete')){
    const codes = Array.from(ExportSel.values());
    if (!codes.length) { toast('No patients selected.','warn'); return; }
    if (!confirm('Delete selected patients? This cannot be undone.')) return;
    await Sheets.bulkDeletePatients(codes);
    State.patients = State.patients.filter(p=>!codes.includes(p['Patient Code']));
    State.esas     = State.esas.filter(r=>!codes.includes(r['Patient Code']));
    State.ctcae    = State.ctcae.filter(r=>!codes.includes(r['Patient Code']));
    State.labs     = State.labs.filter(r=>!codes.includes(r['Patient Code']));
    ExportSel.clear();
    renderPatientsList();
    renderExportList();
    toast(`Deleted ${codes.length} patients.`,'success');
    refreshSections();
  }
  if (e.target.closest('#btn-export-print') || e.target.closest('#btn-export-print-footer')){
    renderPrintRootAndPrint();
  }
});
document.addEventListener('input', (e)=>{
  if (e.target && e.target.id === 'export-search'){
    renderExportList();
  }
});

// ===== Public Entry =====
export const App = {
  async start(){
    // Apply motion multiplier before any UI renders/animations
    applyMotionSpeedFromStorage();

    // Apply density early (before rendering) for smoother first paint
    try { applyDensityPref(getPreferences()); } catch {}

    bindUI();
    Patients.init?.(Bus, State);
    ESAS.init?.(Bus, State);
    CTCAE.init?.(Bus, State);
    Labs.init?.(Bus, State);
    Dashboard.init?.(Bus, State);
    Importer.init?.(Bus, State);
    AIModule.init?.(Bus, State);
    Symptoms.init?.(Bus, State);
    Summaries.init(Bus, State);
    Calculators.init?.(Bus, State);

    setupMobileUI();              // <— مضافة هنا

    await loadAllFromSheets();
    State.ready=true;
  },
  bus: Bus,
  state: State
};
