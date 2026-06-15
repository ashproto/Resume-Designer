import { store } from './store.js';
import { getSettings } from './persistence.js';
import { getCurrentFontSettings, getSelectedFontFamilies } from './fontService.js';
import { getSpacingSettings } from './spacingService.js';
import { getAccentSettings } from './accentService.js';
import { buildTheme } from './typst/theme.js';
import { modelToTypst } from './typst/generate.js';
import { typstRenderPreview, typstExportPdf, pickPdfSavePath } from './native.js';

function resumeTheme() {
  const s = getSettings();
  return buildTheme({
    pairingId: getCurrentFontSettings().pairingId,
    ...getSelectedFontFamilies(),
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
