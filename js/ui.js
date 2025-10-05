// js/ui.js
// UI helpers: toasts, modals, confirm/prompt dialogs, and small UX niceties.
// Redesigned visually only. Public API remains stable for app.js and others.

let BusRef = null;

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ===========================
   Toast Manager
   =========================== */

const Toasts = (() => {
  const root = () => qs('#toast-root');

  function ensureRoot() {
    if (!root()) {
      const div = document.createElement('div');
      div.id = 'toast-root';
      document.body.appendChild(div);
    }
  }

  function makeToast(message, type = 'info', opts = {}) {
    ensureRoot();
    const host = root();
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = '<span class="mi md">close</span>';

    const msg = document.createElement('div');
    msg.textContent = String(message ?? '');

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.appendChild(msg);
    row.appendChild(close);
    t.appendChild(row);

    host.appendChild(t);

    let closed = false;
    function doClose() {
      if (closed) return;
      closed = true;
      t.style.opacity = '0';
      t.style.transform = 'translateY(6px)';
      setTimeout(() => t.remove(), 220);
    }

    close.addEventListener('click', doClose);

    const dur = Number(opts.duration || 3500);
    if (dur > 0) setTimeout(doClose, dur);

    return { close: doClose, el: t };
  }

  return {
    show: makeToast,
    success(msg, opts) { return makeToast(msg, 'success', opts); },
    danger(msg, opts) { return makeToast(msg, 'danger', opts); },
    warn(msg, opts) { return makeToast(msg, 'warn', opts); },
    info(msg, opts) { return makeToast(msg, 'info', opts); },
  };
})();

/* ===========================
   Modal Manager
   =========================== */

const Modals = (() => {
  let openCount = 0;

  function lockScroll() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockScroll() {
    if (openCount <= 0) {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }

  function open(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.classList.remove('hidden');
    openCount++;
    lockScroll();

    // focus first focusable
    const focusable = qsa('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])', el)
      .filter(n => !n.hasAttribute('disabled'));
    if (focusable[0]) focusable[0].focus();

    el.dispatchEvent(new CustomEvent('modal:open', { bubbles: true, detail: { id } }));
  }

  function close(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('hidden');
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) unlockScroll();
    el.dispatchEvent(new CustomEvent('modal:close', { bubbles: true, detail: { id } }));
  }

  // Close by clicking backdrop or [data-close-modal]
  function setupDelegation() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-close-modal]');
      if (btn) {
        const id = btn.getAttribute('data-close-modal');
        if (id) close(id);
        return;
      }

      const modal = e.target.closest('.modal');
      if (modal && !e.target.closest('.modal-card')) {
        // click on backdrop
        // find id
        if (modal.id) close(modal.id);
      }
    });

    // ESC to close the last opened modal (heaviest)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const opened = qsa('.modal:not(.hidden)');
        const last = opened[opened.length - 1];
        if (last) {
          e.stopPropagation();
          close(last.id);
        }
      }
    });
  }

  /* ---- Simple dialogs (confirm/prompt) ---- */
  function confirm(message, title = 'Confirm') {
    return new Promise((resolve) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'modal';
      wrapper.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" style="max-width:520px">
          <div class="modal-header">
            <div class="card-title"><span class="mi md">help</span>&nbsp; ${title}</div>
            <button class="icon-btn xbtn" aria-label="Close"><span class="mi md">close</span></button>
          </div>
          <div class="modal-body modal-body-pad">
            <div class="small" style="font-size:15px">${escapeHtml(String(message ?? 'Are you sure?'))}</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost cancel" type="button">Cancel</button>
            <button class="btn btn-primary ok" type="button">OK</button>
          </div>
        </div>`;
      document.body.appendChild(wrapper);
      lockScroll();

      const ok = wrapper.querySelector('.ok');
      const cancel = wrapper.querySelector('.cancel');
      const x = wrapper.querySelector('.xbtn');

      function done(val) {
        wrapper.remove();
        unlockScroll();
        resolve(val);
      }
      ok.addEventListener('click', () => done(true));
      cancel.addEventListener('click', () => done(false));
      x.addEventListener('click', () => done(false));

      // escape closes
      setTimeout(() => ok.focus(), 0);
      wrapper.addEventListener('click', (e) => {
        if (e.target === wrapper) done(false);
      });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); document.removeEventListener('keydown', onKey); }
        if (e.key === 'Enter') { e.preventDefault(); done(true); document.removeEventListener('keydown', onKey); }
      });
    });
  }

  function prompt(message, defaultValue = '') {
    return new Promise((resolve) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'modal';
      wrapper.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" style="max-width:560px">
          <div class="modal-header">
            <div class="card-title"><span class="mi md">edit_note</span>&nbsp; Prompt</div>
            <button class="icon-btn xbtn" aria-label="Close"><span class="mi md">close</span></button>
          </div>
          <div class="modal-body modal-body-pad">
            <div class="field">
              <span class="label">${escapeHtml(String(message ?? 'Enter a value'))}</span>
              <input class="pinput" type="text" value="${escapeHtmlAttr(String(defaultValue ?? ''))}" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost cancel" type="button">Cancel</button>
            <button class="btn btn-primary ok" type="button">OK</button>
          </div>
        </div>`;
      document.body.appendChild(wrapper);
      lockScroll();

      const ok = wrapper.querySelector('.ok');
      const cancel = wrapper.querySelector('.cancel');
      const x = wrapper.querySelector('.xbtn');
      const input = wrapper.querySelector('.pinput');

      function done(val) {
        const out = val ? input.value : null;
        wrapper.remove();
        unlockScroll();
        resolve(out);
      }
      ok.addEventListener('click', () => done(true));
      cancel.addEventListener('click', () => done(false));
      x.addEventListener('click', () => done(false));

      setTimeout(() => input.focus(), 0);
      wrapper.addEventListener('click', (e) => {
        if (e.target === wrapper) done(false);
      });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); done(false); document.removeEventListener('keydown', onKey); }
        if (e.key === 'Enter') { e.preventDefault(); done(true); document.removeEventListener('keydown', onKey); }
      });
    });
  }

  return { open, close, setupDelegation, confirm, prompt };
})();

/* ===========================
   Helpers
   =========================== */

function escapeHtml(str) {
  return str.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}
function escapeHtmlAttr(str) {
  return str.replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

/* ===========================
   Public UI API
   =========================== */

export const UI = {
  init(Bus) {
    BusRef = Bus || null;

    // Wire open buttons if app logic didn't already
    const openSettings = qs('#open-settings');
    if (openSettings) {
      openSettings.addEventListener('click', () => Modals.open('settings-modal'));
    }
    const openImporter = qs('#open-importer');
    if (openImporter) {
      openImporter.addEventListener('click', () => Modals.open('importer-modal'));
    }

    // Close delegation (backdrop + [data-close-modal])
    Modals.setupDelegation();

    // Forward bus notifications to fancy toasts if Bus offers 'on'
    try {
      Bus?.on?.('toast', ({ message, type, opts }) => {
        Toasts.show(message, type, opts);
      });
    } catch (_) {}
  },

  toast(message, type = 'info', opts = {}) {
    return Toasts.show(message, type, opts);
  },
  notify(message, type = 'info', opts = {}) {
    return Toasts.show(message, type, opts);
  },

  openModal(id) { Modals.open(id); },
  closeModal(id) { Modals.close(id); },

  async confirm(message, title) {
    return await Modals.confirm(message, title);
  },

  async prompt(message, defaultValue) {
    return await Modals.prompt(message, defaultValue);
  }
};
