// js/sheets.js
// Apps Script Bridge client (JSONP-first; avoids CORS on GitHub Pages)
// Fix: reduce false "Import failed" by (1) longer timeout, (2) verifying inserted codes on timeout.

const TABS = { PATIENTS: 'Patients', ESAS: 'ESAS', CTCAE: 'CTCAE', LABS: 'Labs' };

const SCHEMA = {
  [TABS.PATIENTS]: [
    'Patient Code','Patient Name','Patient Age','Room','Admitting Provider','Diagnosis','Diet','Isolation','Comments',
    'Section','Done','Updated At','HPI Diagnosis','HPI Previous','HPI Current','HPI Initial','Patient Assessment','Medication List','Latest Notes',
    'Symptoms','Symptoms Notes','Labs Abnormal'
  ],
  [TABS.ESAS]: [
    'Patient Code','Pain','Pain Note','Tiredness','Tiredness Note','Drowsiness','Drowsiness Note','Nausea','Nausea Note',
    'Lack of Appetite','Lack of Appetite Note','Shortness of Breath','Shortness of Breath Note','Depression','Depression Note',
    'Anxiety','Anxiety Note','Wellbeing','Wellbeing Note','Updated At'
  ],
  [TABS.CTCAE]: [
    'Patient Code','Enabled','Fatigue','Fatigue Note','Sleep','Sleep Note','Nausea','Nausea Note','Vomiting','Vomiting Note',
    'Constipation','Constipation Note','Diarrhea','Diarrhea Note','Dyspnea','Dyspnea Note','Odynophagia','Odynophagia Note',
    'Dysphagia','Dysphagia Note','Confusion/Delirium','Confusion/Delirium Note','Peripheral Neuropathy','Peripheral Neuropathy Note',
    'Mucositis','Mucositis Note','Other','Updated At'
  ],
  [TABS.LABS]: [
    'Patient Code','WBC','HGB','PLT','ANC','CRP','Albumin','CRP Trend','Sodium (Na)','Potassium (K)','Chloride (Cl)',
    'Calcium (Ca)','Phosphorus (Ph)','Alkaline Phosphatase (ALP)','Creatinine (Scr)','BUN','Total Bile','Other','Updated At'
  ]
};

let CONFIG = { spreadsheetId:'', bridgeUrl:'', useOAuth:false };

/* ========== JSONP core ========== */
function jsonp(url, timeoutMs = 120000) { // 120s (كان 30s)
  return new Promise((resolve, reject)=>{
    const cbName = 'pr_cb_' + Math.random().toString(36).slice(2);
    const sep = url.includes('?') ? '&' : '?';
    const full = `${url}${sep}callback=${cbName}`;
    const s = document.createElement('script');
    const timer = setTimeout(()=>{ cleanup(); reject(new Error('Bridge timeout')); }, timeoutMs);

    function cleanup(){
      clearTimeout(timer);
      try{ delete window[cbName]; }catch{}
      if (s.parentNode) s.parentNode.removeChild(s);
    }

    window[cbName] = function(resp){
      cleanup();
      try{
        if (!resp || resp.ok !== true) reject(new Error(resp && resp.error ? resp.error : 'Bridge error'));
        else resolve(resp.data);
      }catch(e){ reject(e); }
    };

    s.onerror = ()=>{ cleanup(); reject(new Error('Bridge network error')); };
    s.src = full;
    document.head.appendChild(s);
  });
}

function assertConfig(){
  if (!CONFIG.spreadsheetId) throw new Error('Spreadsheet ID is required.');
  if (!CONFIG.bridgeUrl)     throw new Error('Bridge URL is required.');
}

function buildQuery(action, payload){
  assertConfig();
  const params = new URLSearchParams();
  params.set('action', action);
  params.set('spreadsheetId', CONFIG.spreadsheetId);
  params.set('payload', JSON.stringify(payload || {}));
  return `${CONFIG.bridgeUrl}?${params.toString()}`;
}

async function bridgeCallJSONP(action, payload, timeoutMs){
  const url = buildQuery(action, payload);
  return jsonp(url, timeoutMs);
}

/* ========== helpers ========== */
function toRowFromObject(obj, tabName){
  const cols = SCHEMA[tabName] || [];
  return cols.map(c => (obj && obj[c] != null) ? obj[c] : '');
}

// تقدير طول الرابط لتجميع دفعات كبيرة بأقل عدد طلبات
const MAX_URL_LEN = 9000;
function willFitInUrl(action, payload){
  const url = buildQuery(action, payload);
  return url.length <= MAX_URL_LEN;
}

// تجميع كائنات المرضى إلى دفعات {rows,codes} بحيث كل دفعة لا تتجاوز طول الرابط
function packPatientsAdaptive(objs){
  const batches = [];
  let curRows=[], curCodes=[];
  for (const o of (objs||[])){
    const row = toRowFromObject(o, TABS.PATIENTS);
    const code = o && o['Patient Code'] ? String(o['Patient Code']) : '';
    const candidateRows = [...curRows, row];
    const candidatePayload = { rows: candidateRows };
    if (willFitInUrl('bulkInsertPatients', candidatePayload)){
      curRows = candidateRows;
      curCodes.push(code);
    } else {
      if (curRows.length) batches.push({ rows: curRows, codes: curCodes });
      curRows = [row];
      curCodes = [code];
      // في الحالة النادرة جدًا لو صف واحد لا يلائم الطول، نرسله كما هو (قد يتأخر لكنه سينجح عادة)
      if (!willFitInUrl('bulkInsertPatients', { rows: curRows })) {
        batches.push({ rows: curRows, codes: curCodes });
        curRows = []; curCodes = [];
      }
    }
  }
  if (curRows.length) batches.push({ rows: curRows, codes: curCodes });
  return batches;
}

// تحقّق بعد المهلة: هل الأكواد المطلوبة موجودة فعليًا في الشيت؟
async function verifyCodesExist(codes){
  try{
    const data = await bridgeCallJSONP('loadAll', {}, 60000);
    const set = new Set((data?.patients||[]).map(p=>p['Patient Code']));
    return codes.every(c => set.has(c));
  }catch{ return false; }
}

/* ========== Public API ========== */
export const Sheets = {
  async init(config){
    CONFIG = {
      spreadsheetId: config.spreadsheetId,
      bridgeUrl: (config.bridgeUrl || '').replace(/\/$/, ''),
      useOAuth: false
    };
    return true;
  },

  async loadAll(){ return bridgeCallJSONP('loadAll', {}, 60000); },

  async ensureSection(){ await bridgeCallJSONP('ensureSection', {}, 30000); return true; },
  async createSection(){ return true; },
  async renameSection(oldName, newName){ await bridgeCallJSONP('renameSection', { oldName, newName }, 30000); return true; },
  async deleteSection(name){ await bridgeCallJSONP('deleteSection', { name }, 30000); return true; },

  async insertPatient(obj){
    const row = toRowFromObject(obj, TABS.PATIENTS);
    await bridgeCallJSONP('insertPatient', { row }, 45000); return true;
  },

  // ===== Fast & resilient bulk insert =====
  async bulkInsertPatients(objs){
    const batches = packPatientsAdaptive(objs);
    for (const b of batches){
      try{
        await bridgeCallJSONP('bulkInsertPatients', { rows: b.rows }, 120000); // مهلة أطول
      }catch(err){
        // احتمال كبير أنه timeout لكن البيانات انكتبت؛ نتحقّق
        const ok = await verifyCodesExist(b.codes);
        if (!ok) throw err; // فعلاً فشل
        // إذا ok=true نكمّل بدون رمي خطأ (نجاح فعلي رغم المهلة)
      }
    }
    return true;
  },

  async writePatientField(code, field, value){
    await bridgeCallJSONP('writePatientField', { code, field, value }, 45000); return true;
  },
  async writePatientFields(code, fields){
    await bridgeCallJSONP('writePatientFields', { code, fields }, 45000); return true;
  },
  async deletePatient(code){
    await bridgeCallJSONP('deletePatient', { code }, 45000); return true;
  },

  async writeESAS(code, obj){
    const row = toRowFromObject(obj, TABS.ESAS);
    await bridgeCallJSONP('writeESAS', { row }, 45000); return true;
  },
  async writeCTCAE(code, obj){
    const row = toRowFromObject(obj, TABS.CTCAE);
    await bridgeCallJSONP('writeCTCAE', { row }, 45000); return true;
  },
  async writeLabs(code, obj){
    const row = toRowFromObject(obj, TABS.LABS);
    await bridgeCallJSONP('writeLabs', { row }, 45000); return true;
  },

  // ===== Bulk delete (سريع من جهة الخادم) =====
  async deletePatientsInSection(section){
    if (!section) return false;
    await bridgeCallJSONP('deletePatientsInSection', { section }, 90000);
    return true;
    },
  async bulkDeletePatients(codes){
    const list = Array.isArray(codes) ? codes.filter(Boolean) : [];
    if (!list.length) return true;
    // تقسيم بحسب طول الرابط (نرسل أكبر دفعات ممكنة)
    const batches = [];
    let cur=[]; 
    for (const c of list){
      const cand = [...cur, c];
      if (willFitInUrl('bulkDeletePatients', { codes: cand })) cur = cand;
      else { batches.push(cur); cur = [c]; }
    }
    if (cur.length) batches.push(cur);
    for (const b of batches){
      await bridgeCallJSONP('bulkDeletePatients', { codes: b }, 90000);
    }
    return true;
  }
};
