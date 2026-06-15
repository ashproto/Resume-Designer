import { store } from './store.js';
import { getSettings } from './persistence.js';
import { getCurrentFontSettings } from './fontService.js';
import { getSpacingSettings } from './spacingService.js';
import { getAccentSettings } from './accentService.js';
import { buildTheme } from './typst/theme.js';
import { modelToTypst } from './typst/generate.js';
import { typstRenderPreview, typstExportPdf, pickPdfSavePath } from './native.js';

// Layouts the Typst generator covers today (PR 3.2-3.3). Others fall back to capture.
export const TYPST_LAYOUTS = new Set(['sidebar', 'stacked', 'classic', 'right-sidebar']);

function resumeTheme() {
  const s = getSettings();
  return buildTheme({
    pairingId: getCurrentFontSettings().pairingId,
    colorPalette: s.colorPalette,
    customColor: s.customColor,
    spacing: getSpacingSettings(),
    accent: getAccentSettings(),
  });
}

export function activeLayout() { return getSettings().layout; }

// Pure: model (incl. pageSize) + settings -> Typst source. Headless-testable.
export function generateTyp() {
  return modelToTypst(store.getModel(), { theme: resumeTheme(), layout: activeLayout() });
}

// Tauri-only: compile to PDF bytes for the preview.
export function renderPreview() { return typstRenderPreview(generateTyp()); }

// Tauri-only: pick a path, then compile + write there.
export async function exportToPath(filename) {
  const path = await pickPdfSavePath(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  if (!path) return { canceled: true };
  return typstExportPdf(generateTyp());
}
