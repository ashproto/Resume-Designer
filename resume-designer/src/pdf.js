/**
 * PDF Export Utilities
 *
 * Desktop (Tauri): renders the resume in a HIDDEN child WebviewWindow at
 * `/print.html` and captures it via WKWebView.createPDF (macOS) /
 * WebView2.PrintToPdfAsync (Windows). Main window stays unchanged the whole
 * time — no full-screen takeover.
 *
 * Browser fallback: html2pdf.js produces image-based PDFs (not ATS-friendly).
 */

import { isElectron, pickPdfSavePath, capturePdfFromWindow } from './native.js';
import { store } from './store.js';

let html2pdfModule = null;

// Dynamically import html2pdf.js (browser fallback only)
async function loadHtml2Pdf() {
  if (!html2pdfModule) {
    const module = await import('html2pdf.js');
    html2pdfModule = module.default || module;
  }
  return html2pdfModule;
}

export function initPdfExport() {
  const downloadBtn = document.getElementById('download-pdf');
  
  downloadBtn.addEventListener('click', showPdfDialog);
  
  // Initialize the PDF dialog
  initPdfDialog();
}

// Initialize PDF download dialog
function initPdfDialog() {
  // Create modal if it doesn't exist
  if (!document.getElementById('pdf-dialog-overlay')) {
    const dialogHTML = `
      <div class="modal-overlay" id="pdf-dialog-overlay">
        <div class="modal pdf-dialog">
          <div class="modal-header">
            <h3 class="modal-title">Download PDF</h3>
            <button class="modal-close" id="pdf-dialog-close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <div class="modal-content">
            <div class="form-group">
              <label class="form-label" for="pdf-filename">Filename</label>
              <div class="pdf-filename-wrapper">
                <input type="text" id="pdf-filename" class="form-input" placeholder="Resume">
                <span class="pdf-extension">.pdf</span>
              </div>
            </div>
            <div class="pdf-dialog-actions">
              <button class="btn btn-secondary" id="pdf-dialog-cancel">Cancel</button>
              <button class="btn btn-primary" id="pdf-dialog-download">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    
    // Set up event listeners
    const overlay = document.getElementById('pdf-dialog-overlay');
    const closeBtn = document.getElementById('pdf-dialog-close');
    const cancelBtn = document.getElementById('pdf-dialog-cancel');
    const downloadBtn = document.getElementById('pdf-dialog-download');
    const filenameInput = document.getElementById('pdf-filename');
    
    closeBtn?.addEventListener('click', closePdfDialog);
    cancelBtn?.addEventListener('click', closePdfDialog);
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) closePdfDialog();
    });
    
    downloadBtn?.addEventListener('click', () => {
      handleDownloadPdf(filenameInput?.value);
    });
    
    filenameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleDownloadPdf(filenameInput?.value);
      } else if (e.key === 'Escape') {
        closePdfDialog();
      }
    });
  }
}

// Show the PDF dialog
function showPdfDialog() {
  const overlay = document.getElementById('pdf-dialog-overlay');
  const filenameInput = document.getElementById('pdf-filename');
  
  // Get the active variant name for default filename
  const variantDropdown = document.getElementById('variant-dropdown');
  const selectedLabel = variantDropdown?.querySelector('.dropdown-label')?.textContent || 'Resume';
  const defaultFilename = `Colleen-Sinclair-${selectedLabel.trim().replace(/\s+/g, '-')}`;
  
  if (filenameInput) {
    filenameInput.value = defaultFilename;
  }
  
  overlay?.classList.add('show');
  
  // Focus and select filename
  setTimeout(() => {
    filenameInput?.focus();
    filenameInput?.select();
  }, 100);
}

// Close the PDF dialog
function closePdfDialog() {
  const overlay = document.getElementById('pdf-dialog-overlay');
  overlay?.classList.remove('show');
}

async function handleDownloadPdf(customFilename) {
  const resumeEl = document.getElementById('resume');
  
  // Close dialog
  closePdfDialog();
  
  // Validate resume element exists
  if (!resumeEl) {
    console.error('PDF generation failed: Resume element not found');
    alert('Failed to generate PDF: Resume content not found.');
    return;
  }
  
  // Use custom filename or default
  const filename = customFilename ? 
    (customFilename.endsWith('.pdf') ? customFilename : `${customFilename}.pdf`) : 
    'Resume.pdf';
  
  // Show loading state on header button
  const headerBtn = document.getElementById('download-pdf');
  if (headerBtn) {
    headerBtn.disabled = true;
    headerBtn.innerHTML = `
      <svg class="spinner" width="18" height="18" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="20"/>
      </svg>
      Generating...
    `;
  }
  
  try {
    if (isElectron) {
      // Use Electron's native printToPDF - preserves actual text (ATS-compatible)
      console.log('PDF Export: Using native Electron printToPDF...');
      await generatePdfNative(resumeEl, filename);
    } else {
      // Browser fallback: html2pdf.js (produces image-based PDFs)
      console.log('PDF Export: Using html2pdf.js (browser fallback)...');
      await generatePdfWithHtml2Pdf(resumeEl, filename);
    }
    
  } catch (error) {
    console.error('PDF generation failed:', error);
    alert(`Failed to generate PDF: ${error.message || 'Unknown error'}. Check the console for details.`);
  } finally {
    // Restore button state
    if (headerBtn) {
      headerBtn.disabled = false;
      headerBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download PDF
      `;
    }
  }
}

/**
 * Generate PDF via a HIDDEN background Tauri WebviewWindow.
 *
 * Flow:
 *  1. Pick save path via Rust dialog (`pick_pdf_save_path`). Main window
 *     stays unchanged during the dialog — no chrome toggle, no flash.
 *  2. Subscribe to `print-ready` / `print-error` events from the soon-to-be
 *     hidden child window.
 *  3. Spawn a hidden, decoration-less WebviewWindow pointed at `/print.html`.
 *     Its framework-free entry (src/printEntry.js) runs `initPrintMode()`
 *     (services → render → measure → emit ready).
 *  4. Receive the resume's measured bounds via the event payload.
 *  5. Invoke `capture_pdf_from_window` to run WKWebView.createPDF /
 *     WebView2.PrintToPdfAsync against the hidden window's web view.
 *  6. Close the hidden window. The main window never enters pdf-export-mode.
 *
 * `resumeEl` is still passed in but is no longer measured — the print window
 * measures its own copy. Kept in the signature for symmetry with html2pdf.
 */
async function generatePdfNative(_resumeEl, filename) {
  // 0. Flush any pending in-memory edits to localStorage BEFORE the print
  //    window opens. The store's auto-save is debounced (~SAVE_DEBOUNCE_MS),
  //    so a user who types and immediately clicks "Download PDF" can have
  //    their latest characters still sitting in memory while the print window
  //    boots from localStorage and renders stale data. `store.saveNow()`
  //    runs the persistence callback synchronously, eliminating that race.
  try {
    store.saveNow();
  } catch (e) {
    console.warn('PDF Export: store.saveNow() failed; continuing with whatever is in localStorage:', e);
  }

  // 1. Save path (main window's dialog, fully visible / no chrome change).
  //    The Rust side stashes the chosen path in a server-side slot that
  //    `capture_pdf_from_window` consumes — the renderer never feeds the
  //    path back into the capture call.
  const savePath = await pickPdfSavePath(filename);
  if (!savePath) {
    console.log('PDF Export: Save canceled by user');
    return;
  }

  const { listen } = await import('@tauri-apps/api/event');
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

  // Use a unique label per export so we never collide with a previous
  // print window whose `close()` is still being released by the OS.
  // Tauri's WebviewWindow constructor errors (or returns a wrapper for the
  // existing window) when a label is reused before fully torn down — exactly
  // the failure mode where the second export silently hangs.
  const PRINT_LABEL = `pdf-print-${Date.now()}`;

  // Race the ready event against an error event and a timeout. Whichever
  // settles first wins; the others get cleaned up in finally.
  let settled = false;
  let resolveReady;
  let rejectReady;
  const printReady = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const readyTimeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectReady(new Error('Print window did not become ready within 30s'));
    }
  }, 30000);

  // Await the listen() calls so the IPC subscriptions are FULLY registered
  // before we spawn the print window. Without this, on slow systems the
  // print window can emit `print-ready` before our handler is attached
  // (manifesting as a 30s timeout despite the child window working fine).
  //
  // Each handler requires `payload.label === PRINT_LABEL` exactly. Missing
  // or empty labels are rejected too — if `initPrintMode` couldn't resolve
  // its own window label (rare error path) it emits effectively-unlabeled
  // events, and we'd rather time out cleanly than settle the wrong export.
  const matchesThisExport = (payload) =>
    typeof payload?.label === 'string' && payload.label === PRINT_LABEL;
  const unlistenReady = await listen('print-ready', (event) => {
    if (settled) return;
    if (!matchesThisExport(event.payload)) return;
    settled = true;
    clearTimeout(readyTimeout);
    resolveReady(event.payload);
  });
  const unlistenError = await listen('print-error', (event) => {
    if (settled) return;
    if (!matchesThisExport(event.payload)) return;
    settled = true;
    clearTimeout(readyTimeout);
    rejectReady(new Error(event.payload?.error ?? 'Print window error'));
  });
  // Diagnostic listener so the main window can see each phase of the print
  // window's init. If print-ready times out, the last step we logged points
  // straight at the hanging step (no guessing).
  const unlistenStep = await listen('print-step', (event) => {
    if (!matchesThisExport(event.payload)) return;
    console.log('[PDF Export] print-step:', event.payload);
  });

  let printWindow = null;
  try {
    // Spawn the render-only window OFF-SCREEN instead of `visible: false`.
    //
    // macOS WKWebView has a known behavior where windows with `visible:
    // false` don't run a full layout/paint pass — `document.fonts.ready`
    // can stall and `getBoundingClientRect()` can return zeros, so the
    // child window never emits a usable `print-ready`. By keeping the
    // window technically visible but positioned far off any user screen,
    // we get the full render pipeline AND the user never sees it.
    //
    // `decorations: false` removes the title bar; `focus: false` stops it
    // stealing keyboard focus; `skipTaskbar: true` keeps it out of the
    // macOS Dock / Windows taskbar.
    printWindow = new WebviewWindow(PRINT_LABEL, {
      url: '/print.html',
      visible: true,
      x: -10000,
      y: -10000,
      decorations: false,
      focus: false,
      skipTaskbar: true,
      // Make the window big enough to fit the full resume so its layout
      // doesn't get squeezed by viewport size. Exact size doesn't matter
      // since createPDF is rect-driven (macOS) or paginated (Windows).
      width: 820,
      height: 1200,
      title: 'Resume Designer — PDF Export',
    });

    // Tauri emits `tauri://created` on the window itself when the OS
    // window has been opened. Failing fast on errors avoids a 30s hang.
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Print window creation timed out')),
        10000
      );
      printWindow.once('tauri://created', () => {
        clearTimeout(timeout);
        resolve();
      });
      printWindow.once('tauri://error', (e) => {
        clearTimeout(timeout);
        reject(new Error(e?.payload?.error ?? 'Print window creation failed'));
      });
    });

    // 4. Wait for print-mode to finish rendering and report bounds.
    const bounds = await printReady;

    // 5. Capture. Width is also passed as pageSize for the Windows path.
    const pageSize = {
      width: bounds.width / 96,
      height: bounds.height / 96,
    };
    const captureRect = {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height,
    };

    console.log(
      `PDF Export: print-window bounds ` +
      `${bounds.width.toFixed(0)}×${bounds.height.toFixed(0)} CSS px ` +
      `(${pageSize.width.toFixed(2)}in × ${pageSize.height.toFixed(2)}in)`
    );

    // No `savePath` arg — Rust resolves the destination from the slot the
    // picker filled. `savePath` is still in scope for diagnostics only.
    const result = await capturePdfFromWindow(PRINT_LABEL, pageSize, captureRect);

    if (result.success) {
      console.log('PDF Export: PDF saved to:', result.filePath || savePath);
    } else if (result.canceled) {
      console.log('PDF Export: Save canceled');
    } else {
      throw new Error(result.error || 'Failed to save PDF file');
    }
  } finally {
    // 6. Cleanup: unsubscribe listeners and close the hidden window.
    try { if (unlistenReady) unlistenReady(); } catch (_) { /* ignore */ }
    try { if (unlistenError) unlistenError(); } catch (_) { /* ignore */ }
    try { if (unlistenStep) unlistenStep(); } catch (_) { /* ignore */ }
    if (printWindow) {
      try {
        await printWindow.close();
      } catch (err) {
        console.warn('PDF Export: failed to close print window:', err);
      }
    }
  }
}

/**
 * Generate PDF using html2pdf.js (browser fallback)
 * NOTE: This produces IMAGE-based PDFs where text is rendered as pixels,
 * not actual selectable text. Use native printToPDF in Electron for ATS compatibility.
 */
async function generatePdfWithHtml2Pdf(resumeEl, filename) {
  // Load html2pdf library
  console.log('PDF Export: Loading html2pdf.js...');
  let html2pdf;
  try {
    html2pdf = await loadHtml2Pdf();
    console.log('PDF Export: html2pdf.js loaded successfully');
  } catch (loadError) {
    console.error('PDF Export: Failed to load html2pdf.js', loadError);
    throw new Error(`Failed to load PDF library: ${loadError.message}`);
  }
  
  // Get the resume's actual rendered dimensions
  const resumeWidth = resumeEl.offsetWidth;
  const resumeHeight = resumeEl.offsetHeight; // Use offsetHeight for more accurate measurement
  
  // Convert pixels to inches (96 DPI)
  const pageWidthInches = resumeWidth / 96;
  // Add a tiny buffer (0.01") to prevent content from spilling to next page
  const pageHeightInches = (resumeHeight / 96) + 0.01;
  
  console.log(`PDF Export: Resume dimensions - ${resumeWidth}px x ${resumeHeight}px (${pageWidthInches.toFixed(2)}" x ${pageHeightInches.toFixed(2)}")`);
  
  // html2canvas options for high quality output
  const options = {
    margin: 0,
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { 
      scale: 2,                      // 2x scale for high quality
      useCORS: true,
      logging: false,
      allowTaint: true,
      foreignObjectRendering: false,
      removeContainer: true,
      backgroundColor: '#ffffff',
      imageTimeout: 0,
      height: resumeHeight,          // Explicitly set height to match element
      windowHeight: resumeHeight,
      ignoreElements: (element) => {
        const tag = element.tagName?.toLowerCase();
        return tag === 'script' || tag === 'noscript' || tag === 'iframe';
      }
    },
    jsPDF: { 
      unit: 'in', 
      format: [pageWidthInches, pageHeightInches],
      orientation: 'portrait'
    }
  };
  
  console.log('PDF Export: Starting PDF generation (image-based)...');
  
  try {
    // Browser: Direct download
    await html2pdf().set(options).from(resumeEl).save();
    console.log('PDF Export: PDF download initiated');
  } catch (renderError) {
    console.error('PDF Export: Render failed', renderError);
    throw new Error(`PDF rendering failed: ${renderError.message}`);
  }
}
