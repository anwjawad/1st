// js/calculators.js
// Clinical calculators: ECOG, Opioid Converter, PPI, PPS
// - Each in its own modal
// - ECOG, PPI, PPS include "Link to patient" → append to Current HPI via Bus event
// - Opioid converter uses editable equivalence table + automatic reverse conversions
//
// NOTE (clinical disclaimer shown in UI):
// These tools are for quick reference only and do not replace clinical judgment.

import { Utils } from './utils.js';

let Bus = null, State = null;

/* ========== Helpers ========== */
const qs  = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
function ensureModal({ id, title, bodyHTML, footerHTML='' }) {
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement('div');
  el.id = id;
  el.className = 'modal hidden';
  el.innerHTML = `
    <div class="modal-card modal-card--wide" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="card-title">${title}</div>
        <button class="icon-btn" data-close-modal="${id}" aria-label="Close">✕</button>
      </div>
      <div class="modal-body modal-body-pad">${bodyHTML}</div>
      <div class="modal-footer">
        <div class="calc-note">For reference only — verify for your institution.</div>
        <div style="flex:1"></div>
        ${footerHTML}
        <button class="btn" data-close-modal="${id}">Close</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  // delegation already wired by UI.Modals; keep fallback:
  el.addEventListener('click', (e)=> {
    if (e.target.closest('[data-close-modal]')) el.classList.add('hidden');
    if (e.target === el) el.classList.add('hidden');
  });
  return el;
}
function openModal(id){ const m = document.getElementById(id); if (!m) return; m.classList.remove('hidden'); document.documentElement.style.overflow='hidden'; }
function closeModal(id){ const m=document.getElementById(id); if (!m) return; m.classList.add('hidden'); document.documentElement.style.overflow=''; }
function activePatientCode(){
  const pm = document.getElementById('patient-modal');
  return pm?.dataset?.code || (State?.activePatient && State.activePatient['Patient Code']) || '';
}
function appendToHPI(text){
  const code = activePatientCode();
  if (!code) { Bus.emit?.('toast', { message:'Open a patient first.', type:'warn' }); return; }
  Bus.emit?.('calc.appendToHPI', { code, text });
}

/* ========== ECOG ========== */
function mountECOG(){
  const id = 'calc-ecog-modal';
  const options = [
    [0, 'Fully active, no restrictions'],
    [1, 'Restricted in physically strenuous activity'],
    [2, 'Ambulatory, unable to work; up >50% of daytime'],
    [3, 'Limited self-care; in bed/chair >50% of daytime'],
    [4, 'Completely disabled; totally confined to bed/chair'],
    [5, 'Dead']
  ];
  const body = `
    <div class="calc-grid">
      <div class="calc-card">
        <div class="field">
          <span class="label">ECOG Status (0–5)</span>
          <select id="ecog-select">
            ${options.map(([v, t]) => `<option value="${v}">${v} — ${t}</option>`).join('')}
          </select>
        </div>
        <div class="calc-row">
          <button id="ecog-copy" class="btn btn-ghost">Copy</button>
          <button id="ecog-link" class="btn btn-primary">Link to Latest Notes</button>
        </div>
      </div>
      <div class="calc-card">
        <div class="label">Summary</div>
        <div id="ecog-out" class="calc-out"></div>
      </div>
    </div>`;
  ensureModal({ id, title:'ECOG Performance Status', bodyHTML: body });

  function compute(){
    const v = Number(qs('#ecog-select').value || 0);
    const txt = options.find(o => o[0]===v)?.[1] || '';
    const line = `ECOG: ${v} — ${txt} (${Utils.formatDateTime(new Date().toISOString())})`;
    qs('#ecog-out').textContent = line;
    return line;
  }
  document.getElementById(id).addEventListener('change', (e)=>{ if (e.target.id==='ecog-select') compute(); });
  qs('#ecog-copy').onclick = async ()=> { const line=compute(); await Utils.copyToClipboard(line); Bus.emit?.('toast',{message:'Copied.',type:'success'}); };
  qs('#ecog-link').onclick = ()=> { const line=compute(); appendToHPI(line); };

  compute();
}

/* ========== PPS ========== */
function mountPPS(){
  const id = 'calc-pps-modal';
  const body = `
    <div class="calc-grid">
      <div class="calc-card">
        <div class="field">
          <span class="label">PPS (%)</span>
          <select id="pps-select">
            ${Array.from({length:11},(_,i)=>100 - i*10).map(v=>`<option value="${v}">${v}%</option>`).join('')}
          </select>
        </div>
        <div class="calc-row">
          <button id="pps-copy" class="btn btn-ghost">Copy</button>
          <button id="pps-link" class="btn btn-primary">Link to Latest Notes</button>
        </div>
      </div>
      <div class="calc-card">
        <div class="label">Summary</div>
        <div id="pps-out" class="calc-out"></div>
      </div>
    </div>`;
  ensureModal({ id, title:'Palliative Performance Scale (PPS)', bodyHTML: body });

  function compute(){
    const v = Number(qs('#pps-select').value || 100);
    const line = `PPS: ${v}% (${Utils.formatDateTime(new Date().toISOString())})`;
    qs('#pps-out').textContent = line;
    return line;
  }
  document.getElementById(id).addEventListener('change', (e)=>{ if (e.target.id==='pps-select') compute(); });
  qs('#pps-copy').onclick = async ()=> { const line=compute(); await Utils.copyToClipboard(line); Bus.emit?.('toast',{message:'Copied.',type:'success'}); };
  qs('#pps-link').onclick = ()=> { const line=compute(); appendToHPI(line); };

  compute();
}

/* ========== PPI ========== */
// Components: PPS, Oral intake, Edema, Dyspnea at rest, Delirium
// Scoring (typical published bands; verify locally):
// - PPS: 10–20 → 4; 30–50 → 2.5; 60+ → 0
// - Oral intake: severely reduced → 2.5; moderately reduced → 1; normal → 0
// - Edema present → 1
// - Dyspnea at rest present → 3.5
// - Delirium present → 4
function mountPPI(){
  const id = 'calc-ppi-modal';
  const body = `
    <div class="calc-grid">
      <div class="calc-card">
        <div class="field">
          <span class="label">PPS (%)</span>
          <select id="ppi-pps">
            ${[100,90,80,70,60,50,40,30,20,10,0].map(v=>`<option value="${v}">${v}%</option>`).join('')}
          </select>
        </div>
        <label class="field">
          <span class="label">Oral intake</span>
          <select id="ppi-intake">
            <option value="0">Normal (0)</option>
            <option value="1">Moderately reduced (1)</option>
            <option value="2.5">Severely reduced (2.5)</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Edema</span>
          <select id="ppi-edema">
            <option value="0">Absent (0)</option>
            <option value="1">Present (1)</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Dyspnea at rest</span>
          <select id="ppi-dyspnea">
            <option value="0">Absent (0)</option>
            <option value="3.5">Present (3.5)</option>
          </select>
        </label>
        <label class="field">
          <span class="label">Delirium</span>
          <select id="ppi-delirium">
            <option value="0">Absent (0)</option>
            <option value="4">Present (4)</option>
          </select>
        </label>
        <div class="calc-row">
          <button id="ppi-copy" class="btn btn-ghost">Copy</button>
          <button id="ppi-link" class="btn btn-primary">Link to Latest Notes</button>
        </div>
      </div>

      <div class="calc-card">
        <div class="label">Score</div>
        <div id="ppi-score" class="calc-out"></div>
        <div style="margin-top:6px" id="ppi-band"></div>
      </div>
    </div>`;
  ensureModal({ id, title:'Palliative Prognostic Index (PPI)', bodyHTML: body });

  function ppsPoints(pps){
    if (pps >= 60) return 0;
    if (pps >= 30) return 2.5;
    return 4; // PPS 10–20 (or lower)
  }
  function band(score){
    // Typical risk groups:
    // ≤4: better prognosis; 4–6: intermediate; >6: poor (e.g., ~3-week mortality risk high)
    if (score <= 4) return { txt:'Low risk', cls:'good' };
    if (score <= 6) return { txt:'Intermediate risk', cls:'warn' };
    return { txt:'High risk', cls:'danger' };
  }
  function compute(){
    const pps = Number(qs('#ppi-pps').value || 60);
    const s = ppsPoints(pps) +
              Number(qs('#ppi-intake').value) +
              Number(qs('#ppi-edema').value) +
              Number(qs('#ppi-dyspnea').value) +
              Number(qs('#ppi-delirium').value);
    const sc = Number(s.toFixed(1));
    const b = band(sc);
    qs('#ppi-score').textContent = `PPI: ${sc}`;
    qs('#ppi-band').innerHTML = `<span class="calc-badge ${b.cls}">${b.txt}</span>`;
    const line = `PPI: ${sc} (${b.txt}), PPS ${pps}% — ${Utils.formatDateTime(new Date().toISOString())}`;
    return line;
  }
  document.getElementById(id).addEventListener('change', compute);
  qs('#ppi-copy').onclick = async ()=> { const line=compute(); await Utils.copyToClipboard(line); Bus.emit?.('toast',{message:'Copied.',type:'success'}); };
  qs('#ppi-link').onclick = ()=> { const line=compute(); appendToHPI(line); };
  compute();
}

/* ========== Opioid Converter ========== */
/*
   Base table (editable in UI):
   - Oral Morphine  (OM) ↔ IV Morphine (IVM): 3:1 (OM:IVM)
   - Oral Oxycodone (OO) : OM ratio ~ 1 : 1.5  (i.e., OM mg = OO mg * 1.5)
   - Fentanyl patch (FEN mcg/hr) ≈ OM per 24h using 25 mcg/hr ≈ 60 mg OM
     → OM mg/day = FEN(μg/h) * 2.4
   This is a common reference; ALWAYS apply clinical judgment & round conservatively.
*/
function mountOpioid(){
  const id = 'calc-opioid-modal';
  const body = `
    <div class="calc-grid">
      <div class="calc-card">
        <div class="calc-row">
          <label class="field">
            <span class="label">Known value</span>
            <select id="opioid-src">
              <option value="om">Oral Morphine (mg/day)</option>
              <option value="ivm">IV Morphine (mg/day)</option>
              <option value="oxy">Oral Oxycodone “OxyContin” (mg/day)</option>
              <option value="fent">Fentanyl Patch (mcg/hour)</option>
            </select>
          </label>
          <label class="field">
            <span class="label">Dose</span>
            <input id="opioid-val" type="number" min="0" step="0.1" placeholder="e.g., 60" />
          </label>
        </div>

        <details style="margin:6px 0">
          <summary class="small">Equivalence table (editable)</summary>
          <div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px">
            <label class="field">
              <span class="label">Oral Morphine : IV Morphine</span>
              <input id="eq-om-ivm" type="text" value="3:1"/>
            </label>
            <label class="field">
              <span class="label">Oral Oxycodone : Oral Morphine</span>
              <input id="eq-oxy-om" type="text" value="1:1.5"/>
            </label>
            <label class="field">
              <span class="label">Fentanyl μg/hr → Oral Morphine mg/day (per 1 μg/hr)</span>
              <input id="eq-fent-factor" type="number" step="0.1" value="2.4"/>
            </label>
          </div>
          <div class="calc-note">Edit values to match local guidance.</div>
        </details>

        <div class="calc-row">
          <button id="opioid-copy" class="btn btn-ghost">Copy all</button>
        </div>
      </div>

      <div class="calc-card">
        <div class="label">Converted equivalents</div>
        <div id="opioid-out" class="calc-out"></div>
        <div class="calc-note" style="margin-top:6px">
          Caution: account for incomplete cross-tolerance; consider dose reductions when switching.
        </div>
      </div>
    </div>`;
  ensureModal({ id, title:'Opioid Dose Converter', bodyHTML: body });

  function parseRatio(s, defA=3, defB=1){
    const m = String(s||'').trim().match(/^\s*([0-9.]+)\s*:\s*([0-9.]+)\s*$/);
    if (!m) return [defA, defB];
    return [Number(m[1])||defA, Number(m[2])||defB];
  }

  function compute(){
    const src = qs('#opioid-src').value;
    const v   = Number(qs('#opioid-val').value || 0);
    const [omR, ivmR] = parseRatio(qs('#eq-om-ivm').value, 3, 1); // OM : IVM
    const [oxyR, omR2] = parseRatio(qs('#eq-oxy-om').value, 1, 1.5); // OXY : OM
    const fentK = Number(qs('#eq-fent-factor').value || 2.4); // OM mg/day per 1 μg/hr

    let om = 0; // oral morphine mg/day

    if (src === 'om') om = v;
    if (src === 'ivm') om = v * (omR / ivmR);
    if (src === 'oxy') om = v * (omR2 / oxyR);
    if (src === 'fent') om = v * fentK;

    const ivm  = om * (ivmR / omR);
    const oxy  = om * (oxyR / omR2);
    const fent = om / fentK;

    const lines = [
      `Oral Morphine ≈ ${om.toFixed(0)} mg/day`,
      `IV Morphine ≈ ${ivm.toFixed(0)} mg/day`,
      `Oral Oxycodone (OxyContin) ≈ ${oxy.toFixed(0)} mg/day`,
      `Fentanyl patch ≈ ${fent.toFixed(0)} μg/hour`
    ];
    qs('#opioid-out').textContent = lines.join('\n');
    return lines.join('\n');
  }

  document.getElementById(id).addEventListener('input', compute);
  qs('#opioid-copy').onclick = async ()=> { const txt=compute(); await Utils.copyToClipboard(txt); Bus.emit?.('toast',{message:'Copied.',type:'success'}); };
  compute();
}

/* ========== Public API ========== */
export const Calculators = {
  init(bus, state){ Bus = bus; State = state; },
  openECOG(){ mountECOG(); openModal('calc-ecog-modal'); },
  openPPS(){ mountPPS(); openModal('calc-pps-modal'); },
  openPPI(){ mountPPI(); openModal('calc-ppi-modal'); },
  openOpioid(){ mountOpioid(); openModal('calc-opioid-modal'); }
};
