// js/utils.js
// General utilities: date/time formatting, clipboard, debounce/throttle, ids, etc.

export const Utils = {
  /** 格 تنسيق ISO إلى عرض قصير محلي (تبسيطًا، من دون مكتبات خارجية) */
  formatDateTime(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      // صيغة مختصرة: YYYY-MM-DD HH:MM
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch {
      return String(iso);
    }
  },

  formatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    } catch {
      return String(iso);
    }
  },

  /** نسخ نص إلى الحافظة مع fallback */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text || '');
      return true;
    } catch {
      // fallback: تحديد عنصر مؤقت
      const ta = document.createElement('textarea');
      ta.value = text || '';
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        return true;
      } catch {
        return false;
      } finally {
        ta.remove();
      }
    }
  },

  /** debounce: يؤخر الاستدعاء حتى يتوقف الحدث لزمن محدد */
  debounce(fn, wait = 250) {
    let t = null;
    return function debounced(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  },

  /** throttle: لا يسمح بأكثر من استدعاء واحد كل فترة */
  throttle(fn, wait = 250) {
    let last = 0;
    let timer = null;
    return function throttled(...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        clearTimeout(timer);
        timer = null;
        last = now;
        fn.apply(this, args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn.apply(this, args);
        }, remaining);
      }
    };
  },

  /** توليد معرّف قصير (مفيد للملفات أو المفاتيح المؤقتة) */
  shortId(prefix = '') {
    const core = Math.random().toString(36).slice(2, 9);
    return prefix ? `${prefix}_${core}` : core;
  },

  /** فحص قيمة منطقية (يدعم TRUE/FALSE النصية) */
  asBool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes';
    }
    return !!v;
  },

  /** استنساخ عميق بسيط للكائنات/المصفوفات (بدون توابع/تواريخ) */
  clone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  },

  /** تجميع عناصر مصفوفة حسب مفتاح */
  groupBy(arr, keyFn) {
    const map = new Map();
    (arr || []).forEach(item => {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return map;
  },

  /** دمج كائنين بسيطًا مع أولوية الثاني */
  merge(a, b) {
    return Object.assign({}, a || {}, b || {});
  }
};