// js/pdf-import.js
// Add-on: Import PDF as if CSV (no edits to importer.js)
// - Dynamically loads pdf.js
// - Extracts text tables -> rows
// - Injects into existing Import modal preview and Importer pipeline

const PdfImport = (() => {
  // CDN for pdf.js (ESM)
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs';
  let pdfjs = null;

  // Expected CSV column order (template used by your app)
  const HEADERS = [
    'Patient Code','Patient Name','Patient Age','Room','Diagnosis','Section',
    'Admitting Provider','Diet','Isolation','Comments',
    'Symptoms (comma-separated)','Symptoms Notes (JSON map)','Labs Abnormal (comma-separated)'
  ];

  // Load pdf.js once
  async function ensurePDFJS() {
    if (pdfjs) return pdfjs;
    pdfjs = await import(PDFJS_URL);
    // worker (best-effort)
    if (pdfjs.GlobalWorkerOptions) {
      const worker = PDFJS_URL.replace('pdf.min.mjs', 'pdf.worker.min.js');
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
    }
    return pdfjs;
  }

  // Extract raw text per page
  async function extractTextFromPDF(file) {
    await ensurePDFJS();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Join items into lines by y position
      const lines = [];
      let currentY = null, currentLine = [];
      const tol = 3; // y tolerance
      content.items.forEach(it => {
        const y = Math.round(it.transform[5]);
        if (currentY === null) { currentY = y; }
        if (Math.abs(y - currentY) <= tol) {
          currentLine.push(it.str);
        } else {
          lines.push(currentLine.join(' '));
          currentLine = [it.str];
          currentY = y;
        }
      });
      if (currentLine.length) lines.push(currentLine.join(' '));
      pages.push(lines.join('\n'));
    }
    return pages.join('\n');
  }

  // Heuristic: parse table-ish text into rows/cols
  function parseRows(text) {
    const rawLines = text
      .split(/\r?\n/)
      .map(s => s.replace(/\u00A0/g, ' ').trim())
      .filter(Boolean);

    // Try to detect header line
    let headerIdx = rawLines.findIndex(l => /patient\s*code/i.test(l) && /patient\s*name/i.test(l));
    if (headerIdx === -1) headerIdx = 0;

    const dataLines = rawLines.slice(headerIdx + 1);

    // Split line into cells:
    // 1) prefer commas
    // 2) else split by 2+ spaces
    const splitLine = (line) => {
      if (line.includes(',')) return line.split(',').map(s => s.trim());
      return line.split(/\s{2,}/).map(s => s.trim());
    };

    // Normalize and pad/truncate to columns length
    const COLS = HEADERS.length;
    const rows = [];
    for (const ln of dataLines) {
      const cells = splitLine(ln);
      // skip obvious non-data lines
      if (cells.length < 3) continue;
      // heuristics: try to map common orders (Code, Name, Age, Room, Provider, Diagnosis, Diet, Isolation, Comments)
      // If more than COLS, cut; if less, pad
      const arr = new Array(COLS).fill('');
      // best-effort mapping (expects first ~9 cols in order)
      for (let i = 0; i < Math.min(cells.length, 9); i++) arr[i] = cells[i];

      // Defaults for the trailing app-specific cols:
      // Section: if empty -> "Default"
      if (!arr[5]) arr[5] = 'Default';
      // Symptoms columns left empty if not present
      rows.push(arr.slice(0, COLS));
    }
    return rows;
  }

  // Render preview table
  function renderPreview(rows) {
    const host = document.getElementById('csv-preview');
    if (!host) return;
    host.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'mono small';
    table.style.borderCollapse = 'collapse';
    table.style.width = '100%';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    HEADERS.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      th.style.border = '1px solid var(--border)';
      th.style.padding = '6px 8px';
      th.style.textAlign = 'left';
      th.style.background = 'rgba(124,156,255,.10)';
      thead.appendChild(hr).appendChild(th);
    });
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

  // Wire input to intercept PDF and feed Importer
  function bindInput() {
    const input = document.getElementById('csv-file-input');
    if (!input) return;

    input.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f || f.type !== 'application/pdf') return; // let importer.js handle csv

      // Parse PDF -> rows
      try {
        const txt = await extractTextFromPDF(f);
        const rows = parseRows(txt);
        if (!rows.length) {
          alert('No table-like content detected in this PDF.');
          return;
        }
        renderPreview(rows);

        // Monkey-patch Importer.consumeValidatedRows to return our rows
        // (Non-destructive: only for this session of the modal)
        window.Importer = window.Importer || {};
        window.Importer.consumeValidatedRows = () => rows;

        // Enable the confirm button if disabled
        const btn = document.getElementById('btn-import-confirm');
        if (btn) btn.disabled = false;

      } catch (err) {
        console.error(err);
        alert('Failed to parse PDF. Try exporting the PDF as text or CSV.');
      }
    });
  }

  function initWhenModalAppears() {
    // The import modal is created in DOM already; just bind when DOM ready
    const obs = new MutationObserver(() => {
      if (document.getElementById('csv-file-input')) {
        bindInput();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    initWhenModalAppears();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => PdfImport.init());
