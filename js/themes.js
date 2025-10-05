// js/themes.js
// Lightweight theme tools + modal clarity fixes (no heavy edits elsewhere)

const ThemeManager = (() => {
  const KEY = 'pr.theme';
  const THEMES = ['neon', 'ocean', 'rose'];

  function get() {
    const t = localStorage.getItem(KEY) || 'neon';
    return THEMES.includes(t) ? t : 'neon';
  }
  function set(theme) {
    const t = THEMES.includes(theme) ? theme : 'neon';
    document.body.setAttribute('data-theme', t);
    localStorage.setItem(KEY, t);
  }

  function ensureStyleOverrides() {
    if (document.getElementById('theme-overrides-style')) return;
    const css = `
      /* ==== Modal clarity across all themes ==== */
      .modal { background: rgba(8,10,18,.72) !important; backdrop-filter: blur(4px) saturate(120%) !important; }
      .modal-card, .modal .modal-body {
        background: color-mix(in oklab, var(--bg-2) 84%, #000 16%) !important;
        border: 1px solid var(--border) !important;
      }
      .modal-header, .modal-footer {
        background: color-mix(in oklab, var(--bg-2) 90%, #000 10%) !important;
      }

      /* ==== Section pills visual fixes (prevent "first looks active") ==== */
      #sections-list .pill {
        background: var(--glass) !important;
      }
      #sections-list .pill:hover {
        border-color: var(--primary) !important;
        box-shadow: 0 10px 28px rgba(0,0,0,.25) !important;
      }
      #sections-list .pill:focus:not(.active) {
        /* لا تعطي مظهر active عند الفوكس */
        background: var(--glass) !important;
      }
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

  function injectSettingsUI() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    const body = modal.querySelector('.modal-body');
    if (!body || body.querySelector('#theme-chooser')) return;

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

    // أدخِل عنصر الاختيار أعلى الإعدادات (أول عنصر)
    body.insertBefore(wrap, body.firstChild);

    const select = wrap.querySelector('#theme-select');
    select.value = get();

    wrap.querySelector('#theme-apply').addEventListener('click', () => {
      set(select.value);
    });
    wrap.querySelector('#theme-reset').addEventListener('click', () => {
      set('neon');
      select.value = 'neon';
    });
  }

  // احتياطي: توحيد مظهر active للأقسام إذا حصل خلل بصري
  function fixSectionPillsOnClick() {
    const cont = document.getElementById('sections-list');
    if (!cont) return;
    cont.addEventListener('click', (e) => {
      const pill = e.target.closest('.pill');
      if (!pill) return;
      // نطبّق الستايل البصري فقط — المنطق ما زال في app.js
      cont.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      // تحديث العنوان المعروض أعلى التوب بار (بصري فقط)
      const lbl = document.getElementById('active-section-name');
      if (lbl) lbl.textContent = pill.textContent.trim();
    }, true);
  }

  function init() {
    ensureStyleOverrides();
    set(get());            // طبّق الثيم المحفوظ
    injectSettingsUI();    // أضف أداة التبديل داخل Settings
    fixSectionPillsOnClick();
  }

  return { init, set, get };
})();

document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
