/**
 * PDF Export Utilities
 *
 * Desktop (Tauri): every layout exports via the Typst pipeline — showPdfDialog
 * routes to the Typst export screen (rd:open-typst-export). See typstExport.js.
 *
 * Browser fallback: html2pdf.js produces image-based PDFs (not ATS-friendly).
 */

import { isElectron } from './native.js';
import { getCurrentId, getVariantList } from './variantManager.js';

let html2pdfModule = null;

// Mirror the hidden #download-pdf proxy's busy state onto an app-wide event so
// the visible (React) header PDF button can show its own spinner/disabled state.
// busy:true when generation starts; busy:false on EVERY exit path (success,
// cancel, error). The hidden-button toggling below is kept intact — this is an
// additional event mirror, not a replacement.
function setPdfBusy(busy) {
  window.dispatchEvent(new CustomEvent('rd:pdf-busy', { detail: { busy } }));
}

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
}

function showPdfDialog() {
  // Default filename from the active variant — slugified active-variant name.
  const current = getVariantList().find((v) => v.id === getCurrentId());
  const selectedLabel = current?.name || 'Resume';
  const defaultFilename = selectedLabel.trim().replace(/\s+/g, '-');

  // Desktop: every layout exports via the Typst pipeline.
  if (isElectron) {
    window.dispatchEvent(new CustomEvent('rd:open-typst-export', { detail: { defaultFilename } }));
    return;
  }
  // Browser: filename dialog -> html2pdf image-based fallback.
  window.dispatchEvent(new CustomEvent('rd:open-pdf-dialog', {
    detail: { defaultFilename, onDownload: handleDownloadPdf },
  }));
}

async function handleDownloadPdf(customFilename) {
  const resumeEl = document.getElementById('resume');

  // The React dialog has already closed itself by the time it calls this.

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
  
  // Show loading state on header button (hidden proxy) + mirror to the visible
  // React header button via the rd:pdf-busy event.
  setPdfBusy(true);
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
    // Browser-only path: html2pdf.js (image-based). The desktop app never
    // reaches here — showPdfDialog routes it to the Typst export screen.
    await generatePdfWithHtml2Pdf(resumeEl, filename);
  } catch (error) {
    console.error('PDF generation failed:', error);
    alert(`Failed to generate PDF: ${error.message || 'Unknown error'}. Check the console for details.`);
  } finally {
    // Restore button state on EVERY exit path (success, user-cancel, error).
    // Mirror busy:false to the visible React header button too.
    setPdfBusy(false);
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
