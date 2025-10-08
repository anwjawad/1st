// js/themes.js
// Theme tools + modal clarity fixes

const ThemeManager = (() => {
  const KEY = 'pr.theme';
  const THEMES = ['neon', 'ocean', 'rose'];

  // === Preferences storage ===
  const SETTINGS_KEY = 'pr.settings';
  const DEFAULT_SETTINGS = Object.freeze({
    cardDensity: 'expanded',        // 'compact' | 'expanded'
    sectionOrder: [],               // will be filled from DOM pills when empty
    modalColor: 'auto',             // 'auto' | 'neon' | 'ocean' | 'rose'
  });

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }
  function writeJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
  function getSettings() {
    const saved = readJSON(SETTINGS_KEY, {});
    // merge with defaults (shallow)
    const s = { ...DEFAULT_SETTINGS, ...saved };
    // normalize values
    if (!['compact','expanded'].includes(s.cardDensity)) s.cardDensity = 'expanded';
    if (!['auto','neon','ocean','rose'].includes(s.modalColor)) s.modalColor = 'auto';
    if (!Array.isArray(s.sectionOrder)) s.sectionOrder = [];
    return s;
  }
  function saveSettings(s) {
    writeJSON(SETTINGS_KEY, s);
    // broadcast so app.js (لاحقًا) يقدر يسمع ويطبّق
    window.dispatchEvent(new CustomEvent('pr:preferences-save', { detail: s }));
  }

  // === Theme handling ===
  const setAttr = (val) => {
    // طبّق على html (:root في CSS) وعلى body للاحتياط
    document.documentElement.setAttribute('data-theme', val);
    document.body?.setAttribute('data-theme', val);
  };

  function get() {
    const t = localStorage.getItem(KEY) || 'neon';
    return THEMES.includes(t) ? t : 'neon';
  }
  function set(theme) {
    const t = THEMES.includes(theme) ? theme : 'neon';
    setAttr(t);
    localStorage.setItem(KEY, t);
    // لو المودال على "auto" نعيد تلوينه بناءً على الثيم
    const s = getSettings();
    if (s.modalColor === 'auto') applyModalColor('auto');
  }

  function ensureStyleOverrides() {
    if (document.getElementById('theme-overrides-style')) return;
    const css = `
      /* Modal clarity across all themes */
      .modal { background: rgba(8,10,18,.72) !important; backdrop-filter: blur(4px) saturate(120%) !important; }
      .modal-card, .modal .modal-body {
        background: color-mix(in oklab, var(--bg-2) 84%, #000 16%) !important;
        border: 1px solid var(--border) !important;
      }
      .modal-header, .modal-footer {
        background: color-mix(in oklab, var(--bg-2) 90%, #000 10%) !important;
      }

      /* Section pills visual fixes */
      #sections-list .pill { background: var(--glass) !important; }
      #sections-list .pill.active {
        background: linear-gradient(135deg,
          color-mix(in oklab, var(--primary) 22%, transparent),
          color-mix(in oklab, var(--primary-2) 18%, transparent)
        ) !important;
        border-color: transparent !important;
        box-shadow: 0 8px 30px color-mix(in oklab, var(--primary) 25%, transparent) !important;
      }
    `.trim();
    const style = document.createElement('style');
    style.id = 'theme-overrides-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // === Modal color tint (preferences) ===
  function ensureModalColorStyle() {
    let style = document.getElementById('modal-color-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'modal-color-style';
      document.head.appendChild(style);
    }
    return style;
  }
  function currentThemeGuess() {
    return document.documentElement.getAttribute('data-theme') || get();
  }
  function paletteFor(name) {
    // درجات بسيطة لكل اختيار
    const palettes = {
      neon:  { glow: 'rgba(0,255,200,.25)', ring: 'rgba(0,255,200,.35)' },
      ocean: { glow: 'rgba(64,160,255,.22)', ring: 'rgba(64,160,255,.32)' },
      rose:  { glow: 'rgba(255,64,160,.22)', ring: 'rgba(255,64,160,.32)' },
    };
    return palettes[name] || palettes.neon;
  }
  function applyModalColor(choice) {
    const style = ensureModalColorStyle();
    const sel = choice === 'auto' ? currentThemeGuess() : choice;
    const p = paletteFor(sel);
    style.textContent = `
      .modal-card, .modal .modal-body {
        box-shadow: 0 8px 40px ${p.glow} !important;
      }
      .modal-header {
        box-shadow: inset 0 -1px 0 ${p.ring} !important;
      }
      .modal-footer {
        box-shadow: inset 0 1px 0 ${p.ring} !important;
      }
    `;
    document.body.setAttribute('data-modal-color', sel);
  }

  // === Build Preferences UI inside settings modal ===
  function injectSettingsUI() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const body = modal.querySelector('.modal-body');
    if (!body) return;

    // ---- THEME chooser (existing) ----
    if (!body.querySelector('#theme-chooser')) {
      const wrap = document.createElement('div');
      wrap.className = 'section';
      wrap.id = 'theme-chooser';
      wrap.innerHTML = `
        <div class="section-head">
          <div class="block-title">Theme</div>
        </div>
        <div class="grid" style="grid-template-columns: 1fr auto; gap: 8px;">
          <label class="field">
            <span class="label">Select theme</span>
            <select id="theme-select">
              <option value="neon">Neon</option>
              <option value="ocean">Ocean</option>
              <option value="rose">Rose</option>
            </select>
          </label>
          <div style="display:flex; align-items:flex-end; gap:8px;">
            <button id="theme-apply" class="btn btn-primary">Apply</button>
            <button id="theme-reset" class="btn btn-ghost">Reset</button>
          </div>
        </div>
        <div class="small muted" style="margin-top:6px">
          Your choice is saved locally and applied immediately.
        </div>
      `;
      body.insertBefore(wrap, body.firstChild);

      const select = wrap.querySelector('#theme-select');
      select.value = get();

      wrap.querySelector('#theme-apply').addEventListener('click', () => set(select.value));
      wrap.querySelector('#theme-reset').addEventListener('click', () => { set('neon'); select.value = 'neon'; });
    }

    // ---- PREFERENCES (new) ----
    if (!body.querySelector('#preferences-chooser')) {
      const s = getSettings();

      // read current sections from pills as initial order if empty
      const pills = Array.from(document.querySelectorAll('#sections-list .pill'));
      const domOrder = pills.map(p => p.getAttribute('data-section') || p.textContent.trim());
      if (!s.sectionOrder?.length && domOrder.length) {
        s.sectionOrder = domOrder;
        saveSettings(s); // seed once
      }

      const wrap = document.createElement('div');
      wrap.className = 'section';
      wrap.id = 'preferences-chooser';
      wrap.innerHTML = `
        <div class="section-head" style="margin-top:12px">
          <div class="block-title">Preferences</div>
        </div>

        <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px;">
          <label class="field">
            <span class="label">Card density</span>
            <select id="pref-density">
              <option value="expanded">Expanded</option>
              <option value="compact">Compact</option>
            </select>
          </label>

          <label class="field">
            <span class="label">Modal color</span>
            <select id="pref-modal-color">
              <option value="auto">Auto (follow theme)</option>
              <option value="neon">Neon</option>
              <option value="ocean">Ocean</option>
              <option value="rose">Rose</option>
            </select>
          </label>
        </div>

        <div class="field" style="margin-top:12px">
          <span class="label">Section order</span>
          <div id="pref-sections" class="list" style="display:flex; flex-direction:column; gap:6px;">
            ${ (s.sectionOrder || []).map(key => `
              <div class="row" data-key="${key}" style="display:flex; align-items:center; gap:8px; background:var(--card); border:1px solid var(--border); border-radius:10px; padding:8px;">
                <div class="handle" title="Move" style="cursor:grab; opacity:.7;">☰</div>
                <div class="flex-1" style="flex:1">${key}</div>
                <div class="controls" style="display:flex; gap:6px">
                  <button class="btn btn-ghost btn-xs" data-move="up">↑</button>
                  <button class="btn btn-ghost btn-xs" data-move="down">↓</button>
                </div>
              </div>
            `).join('') }
          </div>
          <div class="small muted" style="margin-top:6px">Use ↑↓ to re-order sections. (Drag not required)</div>
        </div>

        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px">
          <button id="pref-save" class="btn btn-primary">Save</button>
          <button id="pref-reset" class="btn btn-ghost">Reset</button>
        </div>
      `;
      // place after theme section
      const after = body.querySelector('#theme-chooser');
      if (after?.nextSibling) body.insertBefore(wrap, after.nextSibling);
      else body.appendChild(wrap);

      // init inputs
      wrap.querySelector('#pref-density').value = s.cardDensity;
      wrap.querySelector('#pref-modal-color').value = s.modalColor;

      // move handlers
      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-move]');
        if (!btn) return;
        const row = btn.closest('.row');
        const list = wrap.querySelector('#pref-sections');
        if (!row || !list) return;
        if (btn.dataset.move === 'up' && row.previousElementSibling) {
          list.insertBefore(row, row.previousElementSibling);
        } else if (btn.dataset.move === 'down' && row.nextElementSibling) {
          list.insertBefore(row.nextElementSibling, row);
        }
      });

      // save
      wrap.querySelector('#pref-save').addEventListener('click', () => {
        const density = wrap.querySelector('#pref-density').value;
        const modalColor = wrap.querySelector('#pref-modal-color').value;
        const order = Array.from(wrap.querySelectorAll('#pref-sections .row')).map(r => r.getAttribute('data-key'));

        const next = { cardDensity: density, modalColor, sectionOrder: order };
        saveSettings(next);

        // Apply immediate UX hints we can handle here:
        document.body.setAttribute('data-density', density);
        applyModalColor(modalColor);

        // small toast-ish feedback (if no toast system, fallback to alert)
        try {
          window.UI?.toast?.success?.('Preferences saved');
        } catch { /* noop */ }
      });

      // reset
      wrap.querySelector('#pref-reset').addEventListener('click', () => {
        const resetTo = { ...DEFAULT_SETTINGS, sectionOrder: domOrder };
        saveSettings(resetTo);
        wrap.querySelector('#pref-density').value = resetTo.cardDensity;
        wrap.querySelector('#pref-modal-color').value = resetTo.modalColor;

        // rebuild list
        const list = wrap.querySelector('#pref-sections');
        list.innerHTML = resetTo.sectionOrder.map(key => `
          <div class="row" data-key="${key}" style="display:flex; align-items:center; gap:8px; background:var(--card); border:1px solid var(--border); border-radius:10px; padding:8px;">
            <div class="handle" title="Move" style="cursor:grab; opacity:.7;">☰</div>
            <div class="flex-1" style="flex:1">${key}</div>
            <div class="controls" style="display:flex; gap:6px">
              <button class="btn btn-ghost btn-xs" data-move="up">↑</button>
              <button class="btn btn-ghost btn-xs" data-move="down">↓</button>
            </div>
          </div>
        `).join('');

        // Apply immediate defaults
        document.body.setAttribute('data-density', resetTo.cardDensity);
        applyModalColor(resetTo.modalColor);

        try {
          window.UI?.toast?.info?.('Preferences reset');
        } catch { /* noop */ }
      });
    }
  }

  function fixSectionPillsOnClick() {
    const cont = document.getElementById('sections-list');
    if (!cont) return;
    cont.addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      cont.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const lbl = document.getElementById('active-section-name');
      if (lbl) lbl.textContent = pill.textContent.trim();
    }, true);
  }

  function init() {
    ensureStyleOverrides();
    setAttr(get());       // طبّق الثيم المحفوظ على html/body

    // seed density + modalColor on load from saved settings
    const s = getSettings();
    document.body.setAttribute('data-density', s.cardDensity);
    applyModalColor(s.modalColor);

    injectSettingsUI();
    fixSectionPillsOnClick();
  }

  return { init, set, get, getSettings, saveSettings, applyModalColor };
})();

document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
