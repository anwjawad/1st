// js/pdf-import.js
// Import PDF as if CSV (+ optional OCR with Tesseract.js)
// - Keeps importer.js untouched
// - Adds small controls in Import modal: Enable OCR + language

const PdfImport = (() => {
  // CDNs
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs';
  const TESS_URL  = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

  let pdfjs = null;
  let Tesseract = null;

  // Your app's CSV header order
  const HEADERS = [
    'Patient Code','Patient Name','Patient Age','Room','Diagnosis','Section',
    'Admitting Provider','Diet','Isolation','Comments',
    'Symptoms (comma-separated)','Symptoms Notes (JSON map)','Labs Abnormal (comma-separated)'
  ];

  // ====== Lazy loaders ======
  async function ensurePDFJS() {
    if (pdfjs) return pdfjs;
    pdfjs = await import(PDFJS_URL);
    // worker
    if (pdfjs.GlobalWorkerOptions) {
      const worker = PDFJS_URL.replace('pdf.min.mjs', 'pdf.worker.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
    }
    return pdfjs;
  }
  async function ensureTesseract() {
    if (Tesseract) return Tesseract;
    // load UMD
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = TESS_URL;
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    // global
    // eslint-disable-next-line no-undef
    Tesseract = window.Tesseract;
    return Tesseract;
  }

  // ====== UI helpers in Import modal ======
  function injectControls() {
    const modal = document.getElementById('import-modal');
    if (!modal) return;
    const body = modal.querySelector('.modal-body');
    if (!body || body.querySelector('#pdf-extra-controls')) return;

    const box = document.createElement('div');
    box.id = 'pdf-extra-controls';
    box.style.cssText = 'margin-top:10px; display:grid; gap:8px;';
    box.innerHTML = `
      <div class="grid" style="grid-template-columns: auto 1fr auto; gap:8px; align-items:end;">
        <label class="checkbox" style="gap:8px">
          <input id="pdf-enable-ocr" type="checkbox" />
          <span>Enable OCR (scanned PDFs)</span>
        </label>

        <label class="field" style="max-width:240px">
          <span class="label">OCR language</span>
          <select id="pdf-ocr-lang">
            <option value="eng" selected>English (eng)</option>
            <option value="ara">Arabic (ara)</option>
          </select>
        </label>

        <div style="display:flex; gap:8px">
          <button id="pdf-reparse" class="btn">Re-parse</button>
        </div>
      </div>
      <div class="small muted">Tip: keep OCR off for digital PDFs (faster). Turn it on for scanned PDFs (images).</div>
    `;
    body.insertBefore(box, document.getElementById('csv-preview'));
  }
  function getControls() {
    return {
      ocrEnabled: !!document.getElementById('pdf-enable-ocr')?.checked,
      ocrLang: document.getElementById('pdf-ocr-lang')?.value || 'eng'
    };
  }
  function wireReparse(fileRef) {
    const btn = document.getElementById('pdf-reparse');
    if (!btn) return;
    btn.onclick = () => {
      if (fileRef.current) handlePDF(fileRef.current, /*forceOCR*/getControls().ocrEnabled, /*lang*/getControls().ocrLang);
    };
  }

  // ====== PDF extract (text first, then OCR fallback) ======
  async function extractTextWithPDFJS(file) {
    await ensurePDFJS();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;

    const linesAll = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent({ normalizeWhitespace: true });
      const items = content.items || [];
      // group by line using item.y (transform[5]) with tolerance
      const tol = 3;
      let y = null; let line = [];
      const lines = [];
      items.forEach(it => {
        const yy = Math.round(it.transform[5]);
        if (y === null) y = yy;
        if (Math.abs(yy - y) <= tol) {
          line.push(it.str);
        } else {
          if (line.length) lines.push(line.join(' '));
          line = [it.str]; y = yy;
        }
      });
      if (line.length) lines.push(line.join(' '));
      linesAll.push(lines.join('\n'));
    }
    return linesAll.join('\n');
  }

  async function extractTextWithOCR(file, lang='eng') {
    await ensurePDFJS();
    await ensureTesseract();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;

    const parts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // upscale for better OCR
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const { data: { text } } = await Tesseract.recognize(canvas, lang, {
        // logger: m => console.log(m), // uncomment to debug progress
      });
      parts.push(text || '');
    }
    return parts.join('\n');
  }

  // ====== Parse text -> rows ======
  function parseRows(text) {
    const rawLines = text
      .split(/\r?\n/)
      .map(s => s.replace(/\u00A0/g, ' ').trim())
      .filter(Boolean);

    // find header line (best guess)
    let headerIdx = rawLines.findIndex(l =>
      /patient\s*code/i.test(l) && /patient\s*name/i.test(l)
    );
    if (headerIdx === -1) headerIdx = 0;

    const dataLines = rawLines.slice(headerIdx + 1);

    const splitLine = (line) => {
      if (line.includes(',')) return line.split(',').map(s => s.trim());
      return line.split(/\s{2,}/).map(s => s.trim());
    };

    const COLS = HEADERS.length;
    const rows = [];
    for (const ln of dataLines) {
      const cells = splitLine(ln);
      if (cells.length < 3) continue;
      const arr = new Array(COLS).fill('');
      // naive mapping for first ~9 columns
      for (let i = 0; i < Math.min(cells.length, 9); i++) arr[i] = cells[i];

      // Section default
      if (!arr[5]) arr[5] = 'Default';
      rows.push(arr.slice(0, COLS));
    }
    return rows;
  }

  // ====== Preview ======
  function renderPreview(rows) {
    const host = document.getElementById('csv-preview');
    if (!host) return;
    host.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'mono small';
    table.style.borderCollapse = 'collapse';
    table.style.width = '100%';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    HEADERS.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.border = '1px solid var(--border)';
      th.style.padding = '6px 8px';
      th.style.textAlign = 'left';
      th.style.background = 'rgba(124,156,255,.10)';
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(r => {
      const tr = document.createElement('tr');
      r.forEach(v => {
        const td = document.createElement('td');
        td.textContent = v ?? '';
        td.style.border = '1px solid var(--border)';
        td.style.padding = '6px 8px';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  // ====== Glue to Importer ======
  function mountRowsToImporter(rows) {
    window.Importer = window.Importer || {};
    window.Importer.consumeValidatedRows = () => rows;
    const btn = document.getElementById('btn-import-confirm');
    if (btn) btn.disabled = false;
  }

  // ====== Main handler ======
  async function handlePDF(file, forceOCR=false, ocrLang='eng') {
    const previewHost = document.getElementById('csv-preview');
    if (previewHost) {
      previewHost.innerHTML = '<div class="small muted">Parsing PDF…</div>';
    }

    try {
      let text = '';
      let usedOCR = false;

      if (!forceOCR) {
        text = await extractTextWithPDFJS(file);
        // if text is too short (likely scanned), fallback to OCR
        if (!text || text.replace(/\s+/g, '').length < 50) {
          usedOCR = true;
          text = await extractTextWithOCR(file, ocrLang);
        }
      } else {
        usedOCR = true;
        text = await extractTextWithOCR(file, ocrLang);
      }

      const rows = parseRows(text);
      if (!rows.length) {
        alert('Could not detect table rows from this PDF.');
        previewHost && (previewHost.innerHTML = '');
        return;
      }

      renderPreview(rows);
      mountRowsToImporter(rows);

      if (usedOCR) {
        const tip = document.createElement('div');
        tip.className = 'small muted';
        tip.style.marginTop = '6px';
        tip.textContent = `OCR (${ocrLang}) used. Verify columns before import.`;
        previewHost?.appendChild(tip);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to parse this PDF. Try changing OCR setting or export as CSV.');
      previewHost && (previewHost.innerHTML = '');
    }
  }

  // ====== Bind file input ======
  function bindInput() {
    const input = document.getElementById('csv-file-input');
    if (!input) return;

    // Keep a ref to last file for "Re-parse" button
    const fileRef = { current: null };

    input.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      fileRef.current = f;

      // Only intercept PDFs; CSV stays handled by importer.js
      if (f.type !== 'application/pdf') return;

      injectControls();
      wireReparse(fileRef);

      const { ocrEnabled, ocrLang } = getControls();
      await handlePDF(f, ocrEnabled, ocrLang);
    });
  }

  function observeModal() {
    const obs = new MutationObserver(() => {
      if (document.getElementById('csv-file-input')) {
        bindInput();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    observeModal();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => PdfImport.init());
