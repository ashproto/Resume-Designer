/**
 * DesignTab — React port of the vanilla structurePanel.js "Design" tab.
 *
 * Faithful, behavior-preserving conversion of the seven design sections
 * (Color Theme, Header Style, Typography, Layout, Spacing & Sizing, Accents,
 * Profile Photo). It reuses the existing design CSS classes verbatim and calls
 * the same service apply/save APIs the vanilla handlers used.
 *
 * Only palette / layout / customColor dispatch `rd:design-change` for main.js
 * to consume — every other control just applies + saves through its service.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PanelSection } from './PanelSection.jsx';
import { getSettings } from '../../persistence.js';
import {
  FONT_PAIRINGS,
  SYSTEM_FONT_STACKS,
  loadFontPairing,
  loadGoogleFont,
  applyFontSettings,
  getCurrentFontSettings,
  saveFontSettings,
  searchGoogleFonts,
} from '../../fontService.js';
import {
  GRADIENT_STYLES,
  PATTERN_STYLES,
  TEXTURE_STYLES,
  getHeaderStyleSettings,
  saveHeaderStyleSettings,
  applyHeaderStyle,
} from '../../headerStyleService.js';
import {
  getSpacingSettings,
  saveSpacingSettings,
  applySpacingSettings,
  resetSpacingSettings,
} from '../../spacingService.js';
import {
  UNDERLINE_STYLES,
  BULLET_STYLES,
  BORDER_RADIUS_PRESETS,
  getAccentSettings,
  saveAccentSettings,
  applyAccentSettings,
  resetAccentSettings,
} from '../../accentService.js';
import {
  PHOTO_PLACEMENTS,
  PHOTO_SHAPES,
  PHOTO_SIZES,
  getPhotoSettings,
  savePhotoSettings,
  applyPhotoSettings,
  removePhoto,
} from '../../photoService.js';

// ---------------------------------------------------------------------------
// Static data (ported verbatim from structurePanel.js)
// ---------------------------------------------------------------------------

// Color palette definitions
const COLOR_PALETTES = {
  terracotta: { p1: '#c45c3e', p2: '#2d2a26', p3: '#f4e8e4' },
  rose: { p1: '#e11d48', p2: '#4a1025', p3: '#fce7f3' },
  amber: { p1: '#d97706', p2: '#451a03', p3: '#fef3c7' },
  coral: { p1: '#f97316', p2: '#431407', p3: '#ffedd5' },
  ocean: { p1: '#2563eb', p2: '#1e3a5f', p3: '#e8f0fe' },
  teal: { p1: '#0d9488', p2: '#134e4a', p3: '#ccfbf1' },
  forest: { p1: '#059669', p2: '#1a3c34', p3: '#e6f4f0' },
  cyan: { p1: '#0891b2', p2: '#164e63', p3: '#cffafe' },
  plum: { p1: '#7c3aed', p2: '#2d1f47', p3: '#f3e8ff' },
  indigo: { p1: '#4f46e5', p2: '#1e1b4b', p3: '#e0e7ff' },
  slate: { p1: '#64748b', p2: '#1e293b', p3: '#f1f5f9' },
  zinc: { p1: '#52525b', p2: '#18181b', p3: '#f4f4f5' },
};

// Spacing presets
const SPACING_PRESETS = {
  compact: {
    name: 'Compact',
    description: 'Tighter spacing for more content',
    fontScale: 0.9,
    lineHeight: 1.3,
    sectionSpacing: 0.6,
    sidebarWidth: 2.0,
    pageMargins: { top: 0.35, right: 0.35, bottom: 0.35, left: 0.35 },
  },
  normal: {
    name: 'Normal',
    description: 'Balanced and readable',
    fontScale: 1.0,
    lineHeight: 1.45,
    sectionSpacing: 0.8,
    sidebarWidth: 2.2,
    pageMargins: { top: 0.4, right: 0.4, bottom: 0.4, left: 0.4 },
  },
  relaxed: {
    name: 'Relaxed',
    description: 'More breathing room',
    fontScale: 1.05,
    lineHeight: 1.6,
    sectionSpacing: 1.0,
    sidebarWidth: 2.4,
    pageMargins: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
  },
  airy: {
    name: 'Airy',
    description: 'Maximum whitespace',
    fontScale: 1.1,
    lineHeight: 1.75,
    sectionSpacing: 1.2,
    sidebarWidth: 2.5,
    pageMargins: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 },
  },
};

// Layout button definitions (icon SVG + label) — ported from the inline grid.
const LAYOUT_OPTIONS = [
  {
    value: 'sidebar',
    label: 'Sidebar',
    svg: (
      <>
        <rect x="3" y="3" width="7" height="18" rx="1" />
        <rect x="12" y="3" width="9" height="18" rx="1" />
      </>
    ),
  },
  {
    value: 'right-sidebar',
    label: 'Right Side',
    svg: (
      <>
        <rect x="3" y="3" width="9" height="18" rx="1" />
        <rect x="14" y="3" width="7" height="18" rx="1" />
      </>
    ),
  },
  {
    value: 'stacked',
    label: 'Stacked',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="5" rx="1" />
        <rect x="3" y="10" width="18" height="5" rx="1" />
        <rect x="3" y="17" width="18" height="4" rx="1" />
      </>
    ),
  },
  {
    value: 'stacked-vertical',
    label: 'Flow',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="4" rx="1" />
        <rect x="3" y="9" width="18" height="3" rx="1" />
        <rect x="3" y="14" width="18" height="3" rx="1" />
        <rect x="3" y="19" width="18" height="2" rx="1" />
      </>
    ),
  },
  {
    value: 'compact',
    label: 'Compact',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="4" rx="1" />
        <rect x="3" y="9" width="12" height="12" rx="1" />
        <rect x="17" y="9" width="4" height="12" rx="1" />
      </>
    ),
  },
  {
    value: 'executive',
    label: 'Executive',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="6" rx="1" />
        <rect x="3" y="11" width="12" height="10" rx="1" />
        <rect x="17" y="11" width="4" height="10" rx="1" />
      </>
    ),
  },
  {
    value: 'classic',
    label: 'Classic',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="4" rx="1" />
        <rect x="3" y="9" width="18" height="12" rx="1" />
      </>
    ),
  },
  {
    value: 'classic-featured',
    label: 'Featured',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="3" rx="1" />
        <rect x="3" y="8" width="18" height="4" rx="1" />
        <rect x="3" y="14" width="18" height="7" rx="1" />
      </>
    ),
  },
  {
    value: 'modern',
    label: 'Modern',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="3" rx="1" />
        <rect x="3" y="8" width="5" height="13" rx="1" />
        <rect x="10" y="8" width="11" height="13" rx="1" />
      </>
    ),
  },
  {
    value: 'timeline',
    label: 'Timeline',
    svg: (
      <>
        <rect x="3" y="3" width="18" height="4" rx="1" />
        <line x1="7" y1="10" x2="7" y2="21" strokeDasharray="2 2" />
        <rect x="10" y="9" width="11" height="3" rx="0.5" />
        <rect x="10" y="14" width="11" height="3" rx="0.5" />
        <rect x="10" y="19" width="11" height="2" rx="0.5" />
      </>
    ),
  },
  {
    value: 'creative',
    label: 'Creative',
    svg: (
      <>
        <path d="M3 3h18v6H3z" rx="1" />
        <rect x="3" y="11" width="8" height="4" rx="1" />
        <rect x="13" y="11" width="8" height="4" rx="1" />
        <rect x="3" y="17" width="18" height="4" rx="1" />
      </>
    ),
  },
];

// ---------------------------------------------------------------------------
// Local helpers (ported verbatim)
// ---------------------------------------------------------------------------

// Helper to generate dark color from hex
function generateDarkColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Darken by 70%
  const dr = Math.round(r * 0.2).toString(16).padStart(2, '0');
  const dg = Math.round(g * 0.2).toString(16).padStart(2, '0');
  const db = Math.round(b * 0.2).toString(16).padStart(2, '0');
  return `#${dr}${dg}${db}`;
}

// Helper to generate light color from hex
function generateLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Lighten by mixing with white
  const lr = Math.round(r + (255 - r) * 0.9).toString(16).padStart(2, '0');
  const lg = Math.round(g + (255 - g) * 0.9).toString(16).padStart(2, '0');
  const lb = Math.round(b + (255 - b) * 0.9).toString(16).padStart(2, '0');
  return `#${lr}${lg}${lb}`;
}

// Helper to adjust color brightness (used by getCurrentColors)
function adjustColorBrightness(hex, factor) {
  hex = hex.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  const newR = Math.min(255, Math.max(0, Math.round(r + (255 - r) * factor)));
  const newG = Math.min(255, Math.max(0, Math.round(g + (255 - g) * factor)));
  const newB = Math.min(255, Math.max(0, Math.round(b + (255 - b) * factor)));

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Dispatch the design-change event consumed by main.js. Only palette / layout /
// customColor go through here; main.js is a no-op for the other detail types.
function dispatchDesignChange(detail) {
  window.dispatchEvent(new CustomEvent('rd:design-change', { detail }));
}

// Detect if current spacing matches a preset (ported verbatim)
function detectSpacingPreset(spacing) {
  for (const [id, preset] of Object.entries(SPACING_PRESETS)) {
    if (
      Math.abs(spacing.fontScale - preset.fontScale) < 0.05 &&
      Math.abs(spacing.lineHeight - preset.lineHeight) < 0.1 &&
      Math.abs(spacing.sectionSpacing - preset.sectionSpacing) < 0.1
    ) {
      return id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DesignTab() {
  // Seed all design state from the services / persistence on mount.
  const initialSettings = getSettings();
  const [palette, setPalette] = useState(initialSettings.colorPalette || 'terracotta');
  const [layout, setLayout] = useState(initialSettings.layout || 'sidebar');
  const [customColor, setCustomColor] = useState(initialSettings.customColor || '#c45c3e');

  const [fontSettings, setFontSettings] = useState(() => getCurrentFontSettings());
  const [fontSubTab, setFontSubTab] = useState('presets'); // 'presets' | 'google' | 'system'
  const [googleFontSearch, setGoogleFontSearch] = useState('');
  const [googleFontCategory, setGoogleFontCategory] = useState(null);

  const [headerStyle, setHeaderStyle] = useState(() => getHeaderStyleSettings());
  const [headerStyleTab, setHeaderStyleTab] = useState('gradients'); // 'gradients' | 'patterns' | 'textures' | 'image'

  const [spacing, setSpacing] = useState(() => getSpacingSettings());
  const [accent, setAccent] = useState(() => getAccentSettings());
  const [photo, setPhoto] = useState(() => getPhotoSettings());

  // ----- Derived color values (mirrors vanilla getCurrentColors) -----------
  function getCurrentColors() {
    const p = COLOR_PALETTES[palette];
    if (palette === 'custom') {
      return {
        headerBg: generateDarkColor(customColor),
        headerBgEnd: adjustColorBrightness(generateDarkColor(customColor), 0.1),
        accent: customColor,
      };
    }
    return {
      headerBg: p.p2,
      headerBgEnd: adjustColorBrightness(p.p2, 0.15),
      accent: p.p1,
    };
  }

  // ===== Color Theme handlers ==============================================

  function handleSetPalette(key) {
    setPalette(key);
    dispatchDesignChange({ type: 'palette', value: key, customColor });
  }

  function handleCustomColorChange(color) {
    setCustomColor(color);
    // If custom palette is active, apply immediately (matches vanilla).
    if (palette === 'custom') {
      dispatchDesignChange({ type: 'customColor', value: color });
    }
  }

  // ===== Layout handler ====================================================

  function handleSetLayout(value) {
    setLayout(value);
    dispatchDesignChange({ type: 'layout', value });
  }

  // ===== Typography handlers ===============================================

  function getCurrentPreviewFonts() {
    if (fontSettings.mode === 'preset' && fontSettings.pairingId) {
      const pairing = FONT_PAIRINGS[fontSettings.pairingId];
      if (pairing) {
        return {
          display: `'${pairing.display.family}', ${pairing.display.category}`,
          body: `'${pairing.body.family}', ${pairing.body.category}`,
        };
      }
    } else if (fontSettings.mode === 'google') {
      return {
        display: fontSettings.displayFont
          ? `'${fontSettings.displayFont.family}', ${fontSettings.displayFont.category}`
          : 'serif',
        body: fontSettings.bodyFont
          ? `'${fontSettings.bodyFont.family}', ${fontSettings.bodyFont.category}`
          : 'sans-serif',
      };
    } else if (fontSettings.mode === 'system') {
      const displayFont = SYSTEM_FONT_STACKS[fontSettings.displayFont];
      const bodyFont = SYSTEM_FONT_STACKS[fontSettings.bodyFont];
      return {
        display: displayFont ? displayFont.family : 'serif',
        body: bodyFont ? bodyFont.family : 'sans-serif',
      };
    }
    return { display: 'serif', body: 'sans-serif' };
  }

  async function handleSelectFontPreset(presetId) {
    const next = { mode: 'preset', pairingId: presetId };
    await loadFontPairing(presetId);
    applyFontSettings(next);
    saveFontSettings(next);
    setFontSettings(next);
  }

  async function handleSelectGoogleFont(family, category, fontType) {
    await loadGoogleFont(family, [400, 500, 600, 700]);

    let next = fontSettings;
    if (next.mode !== 'google') {
      next = { mode: 'google', displayFont: null, bodyFont: null };
    } else {
      next = { ...next };
    }

    if (fontType === 'display') {
      next.displayFont = { family, category };
    } else if (fontType === 'body') {
      next.bodyFont = { family, category };
    }

    applyFontSettings(next);
    saveFontSettings(next);
    setFontSettings(next);
  }

  function handleSelectSystemFont(fontId, fontType) {
    let next = fontSettings;
    if (next.mode !== 'system') {
      next = { mode: 'system', displayFont: null, bodyFont: null };
    } else {
      next = { ...next };
    }

    if (fontType === 'display') {
      next.displayFont = fontId;
    } else if (fontType === 'body') {
      next.bodyFont = fontId;
    }

    applyFontSettings(next);
    saveFontSettings(next);
    setFontSettings(next);
  }

  // ===== Header Style handlers =============================================

  function handleSelectHeaderStyle(styleType, styleId) {
    const next = { ...headerStyle, type: styleType, styleId };
    applyHeaderStyle(next, getCurrentColors());
    saveHeaderStyleSettings(next);
    setHeaderStyle(next);
  }

  function handleHeaderImageOpacity(value) {
    const next = { ...headerStyle, imageOpacity: parseInt(value, 10) / 100 };
    applyHeaderStyle(next, getCurrentColors());
    saveHeaderStyleSettings(next);
    setHeaderStyle(next);
  }

  function handleHeaderImageFit(value) {
    const next = { ...headerStyle, imageFit: value };
    applyHeaderStyle(next, getCurrentColors());
    saveHeaderStyleSettings(next);
    setHeaderStyle(next);
  }

  function handleRemoveHeaderImage() {
    const next = {
      type: 'gradient',
      styleId: 'linear-135',
      customImage: null,
      imageOpacity: 0.3,
      imageFit: 'cover',
    };
    applyHeaderStyle(next, getCurrentColors());
    saveHeaderStyleSettings(next);
    setHeaderStyle(next);
  }

  function handleHeaderImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const next = {
        ...headerStyle,
        type: 'image',
        styleId: 'custom',
        customImage: e.target.result,
        imageOpacity: headerStyle.imageOpacity || 0.3,
        imageFit: headerStyle.imageFit || 'cover',
      };
      applyHeaderStyle(next, getCurrentColors());
      saveHeaderStyleSettings(next);
      setHeaderStyle(next);
    };
    reader.readAsDataURL(file);
  }

  // ===== Spacing handlers ==================================================

  function handleSpacingChange(property, value) {
    const next = { ...spacing, [property]: value };
    applySpacingSettings(next);
    saveSpacingSettings(next);
    setSpacing(next);
  }

  function handleMarginChange(side, value) {
    const next = { ...spacing, pageMargins: { ...spacing.pageMargins, [side]: value } };
    applySpacingSettings(next);
    saveSpacingSettings(next);
    setSpacing(next);
  }

  function handleResetSpacing() {
    setSpacing(resetSpacingSettings());
  }

  function handleApplySpacingPreset(presetId) {
    const preset = SPACING_PRESETS[presetId];
    if (!preset) return;
    const next = {
      fontScale: preset.fontScale,
      lineHeight: preset.lineHeight,
      sectionSpacing: preset.sectionSpacing,
      sidebarWidth: preset.sidebarWidth,
      pageMargins: { ...preset.pageMargins },
    };
    applySpacingSettings(next);
    saveSpacingSettings(next);
    setSpacing(next);
  }

  // ===== Accent handlers ===================================================

  function handleAccentChange(property, value) {
    const next = { ...accent, [property]: value };
    applyAccentSettings(next);
    saveAccentSettings(next);
    setAccent(next);
  }

  function handleResetAccent() {
    setAccent(resetAccentSettings());
  }

  // ===== Photo handlers ====================================================

  function handlePhotoChange(property, value) {
    const next = { ...photo, [property]: value };
    applyPhotoSettings(next);
    savePhotoSettings(next);
    setPhoto(next);
  }

  function handleRemovePhoto() {
    setPhoto(removePhoto());
  }

  function handlePhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const next = { ...photo, enabled: true, imageData: e.target.result };
      applyPhotoSettings(next);
      savePhotoSettings(next);
      setPhoto(next);
    };
    reader.readAsDataURL(file);
  }

  // ----- Dropzone helpers (click-to-upload + drag/drop) --------------------
  function onDropzoneDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('dragover');
  }
  function onDropzoneDragLeave(e) {
    e.currentTarget.classList.remove('dragover');
  }

  // ===== Derived view values ===============================================
  const previewFonts = getCurrentPreviewFonts();
  const colors = getCurrentColors();
  const isSolidHeader = headerStyle.type === 'solid';
  const currentSpacingPreset = detectSpacingPreset(spacing);
  const bulletChar = BULLET_STYLES[accent.bulletStyle]?.char || '•';

  // Reset buttons used as section header extras.
  const spacingResetButton = (
    <button className="panel-reset-btn" type="button" onClick={handleResetSpacing} title="Reset to defaults">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </button>
  );

  const accentResetButton = (
    <button className="panel-reset-btn" type="button" onClick={handleResetAccent} title="Reset to defaults">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
      </svg>
    </button>
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      {/* ===== Color Theme ===== */}
      <PanelSection title="Color Theme">
        <div className="design-palette-grid">
          {Object.entries(COLOR_PALETTES).map(([key, c]) => (
            <button
              key={key}
              className={cn('design-palette-btn', palette === key && 'active')}
              type="button"
              onClick={() => handleSetPalette(key)}
              title={key.charAt(0).toUpperCase() + key.slice(1)}
            >
              <span
                className="design-palette-preview"
                style={{ '--p1': c.p1, '--p2': c.p2, '--p3': c.p3 }}
              />
            </button>
          ))}
        </div>

        {/* Custom Color */}
        <div className="design-custom-color">
          <div className="design-custom-header">
            <span className="design-custom-label">Custom Color</span>
            <label className="design-color-picker">
              <input
                type="color"
                id="design-custom-color"
                value={customColor}
                onChange={(e) => handleCustomColorChange(e.target.value)}
              />
              <span className="design-color-swatch" style={{ backgroundColor: customColor }} />
            </label>
          </div>
          <button
            className={cn('design-palette-btn', 'custom', palette === 'custom' && 'active')}
            type="button"
            onClick={() => handleSetPalette('custom')}
            title="Custom color"
          >
            <span
              className="design-palette-preview"
              id="design-custom-preview"
              style={{
                '--p1': customColor,
                '--p2': generateDarkColor(customColor),
                '--p3': generateLightColor(customColor),
              }}
            />
          </button>
        </div>
      </PanelSection>

      {/* ===== Header Style ===== */}
      <PanelSection title="Header Style">
        {/* Enable/Disable Toggle */}
        <div className="header-style-toggle">
          <div className="header-style-toggle-row">
            <button
              className={cn('header-style-toggle-btn', isSolidHeader && 'active')}
              type="button"
              onClick={() => handleSelectHeaderStyle('solid', 'solid')}
            >
              <span className="toggle-preview" style={{ background: colors.headerBg }} />
              <span className="toggle-label">Solid Color</span>
              <span className="toggle-desc">Use color theme only</span>
            </button>
            <button
              className={cn('header-style-toggle-btn', !isSolidHeader && 'active')}
              type="button"
              onClick={() => handleSelectHeaderStyle('gradient', 'linear-135')}
            >
              <span
                className="toggle-preview styled"
                style={{ background: `linear-gradient(135deg, ${colors.headerBg}, ${colors.headerBgEnd})` }}
              />
              <span className="toggle-label">Styled</span>
              <span className="toggle-desc">Add visual effects</span>
            </button>
          </div>
        </div>

        {!isSolidHeader && (
          <>
            {/* Style Type Tabs */}
            <div className="header-style-tabs">
              <button
                className={cn('header-style-tab', headerStyleTab === 'gradients' && 'active')}
                type="button"
                onClick={() => setHeaderStyleTab('gradients')}
              >
                Gradients
              </button>
              <button
                className={cn('header-style-tab', headerStyleTab === 'patterns' && 'active')}
                type="button"
                onClick={() => setHeaderStyleTab('patterns')}
              >
                Patterns
              </button>
              <button
                className={cn('header-style-tab', headerStyleTab === 'textures' && 'active')}
                type="button"
                onClick={() => setHeaderStyleTab('textures')}
              >
                Textures
              </button>
              <button
                className={cn('header-style-tab', headerStyleTab === 'image' && 'active')}
                type="button"
                onClick={() => setHeaderStyleTab('image')}
              >
                Image
              </button>
            </div>

            {/* Style Content */}
            <div className="header-style-content">
              {headerStyleTab === 'gradients' && (
                <div className="header-style-grid">
                  {Object.entries(GRADIENT_STYLES).map(([id, style]) => (
                    <button
                      key={id}
                      className={cn(
                        'header-style-btn',
                        headerStyle.type === 'gradient' && headerStyle.styleId === id && 'active',
                      )}
                      type="button"
                      onClick={() => handleSelectHeaderStyle('gradient', id)}
                      title={style.name}
                    >
                      <span
                        className="header-style-preview"
                        style={{ background: style.css(colors.headerBg, colors.headerBgEnd) }}
                      />
                      <span className="header-style-label">{style.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {headerStyleTab === 'patterns' && (
                <div className="header-style-grid">
                  {Object.entries(PATTERN_STYLES).map(([id, style]) => (
                    <button
                      key={id}
                      className={cn(
                        'header-style-btn',
                        headerStyle.type === 'pattern' && headerStyle.styleId === id && 'active',
                      )}
                      type="button"
                      onClick={() => handleSelectHeaderStyle('pattern', id)}
                      title={style.name}
                    >
                      <span
                        className="header-style-preview"
                        style={{
                          background: style.css(colors.headerBg, colors.headerBgEnd, colors.accent),
                          backgroundSize: style.size || 'auto',
                        }}
                      />
                      <span className="header-style-label">{style.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {headerStyleTab === 'textures' && (
                <div className="header-style-grid">
                  {Object.entries(TEXTURE_STYLES).map(([id, style]) => (
                    <button
                      key={id}
                      className={cn(
                        'header-style-btn',
                        headerStyle.type === 'texture' && headerStyle.styleId === id && 'active',
                      )}
                      type="button"
                      onClick={() => handleSelectHeaderStyle('texture', id)}
                      title={style.name}
                    >
                      <span
                        className="header-style-preview"
                        style={{ background: style.css(colors.headerBg, colors.headerBgEnd, colors.accent) }}
                      />
                      <span className="header-style-label">{style.name}</span>
                    </button>
                  ))}
                </div>
              )}

              {headerStyleTab === 'image' && (
                <div className="header-image-upload">
                  {headerStyle.customImage ? (
                    <>
                      <div className="header-image-preview">
                        <img src={headerStyle.customImage} alt="Header background" />
                        <button
                          className="header-image-remove"
                          type="button"
                          onClick={handleRemoveHeaderImage}
                          title="Remove image"
                        >
                          ×
                        </button>
                      </div>

                      <div className="header-image-controls">
                        <div className="control-row">
                          <label>Opacity:</label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={Math.round((headerStyle.imageOpacity || 0.3) * 100)}
                            onChange={(e) => handleHeaderImageOpacity(e.target.value)}
                            className="slider-input"
                          />
                          <span className="slider-value">
                            {Math.round((headerStyle.imageOpacity || 0.3) * 100)}%
                          </span>
                        </div>

                        <div className="control-row">
                          <label>Fit:</label>
                          <select
                            value={headerStyle.imageFit}
                            onChange={(e) => handleHeaderImageFit(e.target.value)}
                            className="form-select-small"
                          >
                            <option value="cover">Cover</option>
                            <option value="contain">Contain</option>
                            <option value="tile">Tile</option>
                          </select>
                        </div>
                      </div>
                    </>
                  ) : (
                    <label
                      className="header-image-dropzone"
                      onDragOver={onDropzoneDragOver}
                      onDragLeave={onDropzoneDragLeave}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('dragover');
                        const file = e.dataTransfer.files[0];
                        if (file && file.type.startsWith('image/')) handleHeaderImageFile(file);
                      }}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => handleHeaderImageFile(e.target.files[0])}
                      />
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                      <p>Drop image here or click to upload</p>
                      <span>Recommended: 800x200px or larger</span>
                    </label>
                  )}

                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() => handleSelectHeaderStyle('gradient', 'linear-135')}
                    style={{ marginTop: 'var(--space-sm)', width: '100%' }}
                  >
                    Reset to Gradient
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </PanelSection>

      {/* ===== Typography ===== */}
      <PanelSection title="Typography">
        {/* Live Font Preview */}
        <div className="font-preview-card">
          <div className="font-preview-header" style={{ fontFamily: previewFonts.display }}>
            Jane Smith
          </div>
          <div className="font-preview-body" style={{ fontFamily: previewFonts.body }}>
            Senior Software Engineer with 8+ years of experience building scalable web applications.
          </div>
        </div>

        {/* Font Source Tabs */}
        <div className="font-source-tabs">
          <button
            className={cn('font-source-tab', fontSubTab === 'presets' && 'active')}
            type="button"
            onClick={() => setFontSubTab('presets')}
          >
            Presets
          </button>
          <button
            className={cn('font-source-tab', fontSubTab === 'google' && 'active')}
            type="button"
            onClick={() => setFontSubTab('google')}
          >
            Google Fonts
          </button>
          <button
            className={cn('font-source-tab', fontSubTab === 'system' && 'active')}
            type="button"
            onClick={() => setFontSubTab('system')}
          >
            System
          </button>
        </div>

        {/* Font Content */}
        <div className="font-content">
          {fontSubTab === 'presets' && (
            <div className="font-presets-grid">
              {Object.entries(FONT_PAIRINGS).map(([id, pairing]) => {
                const currentPairing = fontSettings.mode === 'preset' ? fontSettings.pairingId : null;
                return (
                  <button
                    key={id}
                    className={cn('font-preset-btn', currentPairing === id && 'active')}
                    type="button"
                    onClick={() => handleSelectFontPreset(id)}
                  >
                    <span className="font-preset-name">{pairing.name}</span>
                    <span
                      className="font-preset-sample"
                      style={{ fontFamily: `'${pairing.display.family}', serif` }}
                    >
                      Aa
                    </span>
                    <span className="font-preset-families">
                      {pairing.display.family} + {pairing.body.family}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {fontSubTab === 'google' && (
            <div className="google-fonts-picker">
              {/* Search */}
              <div className="font-search">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search fonts..."
                  value={googleFontSearch}
                  onChange={(e) => setGoogleFontSearch(e.target.value)}
                />
              </div>

              {/* Category Filter */}
              <div className="font-category-filter">
                <button
                  className={cn('font-category-btn', !googleFontCategory && 'active')}
                  type="button"
                  onClick={() => setGoogleFontCategory(null)}
                >
                  All
                </button>
                <button
                  className={cn('font-category-btn', googleFontCategory === 'serif' && 'active')}
                  type="button"
                  onClick={() => setGoogleFontCategory('serif')}
                >
                  Serif
                </button>
                <button
                  className={cn('font-category-btn', googleFontCategory === 'sans-serif' && 'active')}
                  type="button"
                  onClick={() => setGoogleFontCategory('sans-serif')}
                >
                  Sans
                </button>
                <button
                  className={cn('font-category-btn', googleFontCategory === 'display' && 'active')}
                  type="button"
                  onClick={() => setGoogleFontCategory('display')}
                >
                  Display
                </button>
              </div>

              {/* Current Selection */}
              <div className="font-current-selection">
                <div className="font-selection-row">
                  <label>Display Font:</label>
                  <span className="font-selection-value">
                    {(fontSettings.mode === 'google' ? fontSettings.displayFont?.family : null) || 'Not set'}
                  </span>
                </div>
                <div className="font-selection-row">
                  <label>Body Font:</label>
                  <span className="font-selection-value">
                    {(fontSettings.mode === 'google' ? fontSettings.bodyFont?.family : null) || 'Not set'}
                  </span>
                </div>
              </div>

              {/* Font List */}
              <div className="font-list">
                {searchGoogleFonts(googleFontSearch, googleFontCategory).map((font) => {
                  const currentDisplay = fontSettings.mode === 'google' ? fontSettings.displayFont?.family : null;
                  const currentBody = fontSettings.mode === 'google' ? fontSettings.bodyFont?.family : null;
                  return (
                    <div className="font-list-item" key={font.family}>
                      <span
                        className="font-list-name"
                        style={{ fontFamily: `'${font.family}', ${font.category}` }}
                      >
                        {font.family}
                      </span>
                      <span className="font-list-category">{font.category}</span>
                      <div className="font-list-actions">
                        <button
                          className={cn('font-select-btn', currentDisplay === font.family && 'active')}
                          type="button"
                          onClick={() => handleSelectGoogleFont(font.family, font.category, 'display')}
                          title="Use as display font"
                        >
                          H
                        </button>
                        <button
                          className={cn('font-select-btn', currentBody === font.family && 'active')}
                          type="button"
                          onClick={() => handleSelectGoogleFont(font.family, font.category, 'body')}
                          title="Use as body font"
                        >
                          B
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {fontSubTab === 'system' && (
            <div className="system-fonts-picker">
              {/* Current Selection */}
              <div className="font-current-selection">
                <div className="font-selection-row">
                  <label>Display Font:</label>
                  <span className="font-selection-value">
                    {fontSettings.mode === 'system' && fontSettings.displayFont
                      ? SYSTEM_FONT_STACKS[fontSettings.displayFont]?.name || fontSettings.displayFont
                      : 'Not set'}
                  </span>
                </div>
                <div className="font-selection-row">
                  <label>Body Font:</label>
                  <span className="font-selection-value">
                    {fontSettings.mode === 'system' && fontSettings.bodyFont
                      ? SYSTEM_FONT_STACKS[fontSettings.bodyFont]?.name || fontSettings.bodyFont
                      : 'Not set'}
                  </span>
                </div>
              </div>

              {/* System Font List */}
              <div className="font-list">
                {Object.entries(SYSTEM_FONT_STACKS).map(([id, font]) => {
                  const currentDisplay = fontSettings.mode === 'system' ? fontSettings.displayFont : null;
                  const currentBody = fontSettings.mode === 'system' ? fontSettings.bodyFont : null;
                  return (
                    <div className="font-list-item" key={id}>
                      <span className="font-list-name" style={{ fontFamily: font.family }}>
                        {font.name}
                      </span>
                      <span className="font-list-category">{font.category}</span>
                      <div className="font-list-actions">
                        <button
                          className={cn('font-select-btn', currentDisplay === id && 'active')}
                          type="button"
                          onClick={() => handleSelectSystemFont(id, 'display')}
                          title="Use as display font"
                        >
                          H
                        </button>
                        <button
                          className={cn('font-select-btn', currentBody === id && 'active')}
                          type="button"
                          onClick={() => handleSelectSystemFont(id, 'body')}
                          title="Use as body font"
                        >
                          B
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="font-hint">
                System fonts work offline and render consistently across devices.
              </p>
            </div>
          )}
        </div>
      </PanelSection>

      {/* ===== Layout ===== */}
      <PanelSection title="Layout">
        <div className="design-layout-grid">
          {LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={cn('design-layout-btn', layout === opt.value && 'active')}
              type="button"
              onClick={() => handleSetLayout(opt.value)}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                {opt.svg}
              </svg>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      </PanelSection>

      {/* ===== Spacing & Sizing ===== */}
      <PanelSection title="Spacing & Sizing" headerExtra={spacingResetButton}>
        {/* Spacing Presets */}
        <div className="spacing-presets">
          {Object.entries(SPACING_PRESETS).map(([id, preset]) => (
            <button
              key={id}
              className={cn('spacing-preset-btn', currentSpacingPreset === id && 'active')}
              type="button"
              onClick={() => handleApplySpacingPreset(id)}
              title={preset.description}
            >
              <span className="preset-name">{preset.name}</span>
            </button>
          ))}
        </div>

        <div className="spacing-divider">
          <span>Fine Tune</span>
        </div>

        {/* Font Scale */}
        <div className="spacing-control">
          <div className="spacing-control-header">
            <label>Font Size</label>
            <span className="spacing-value">{Math.round(spacing.fontScale * 100)}%</span>
          </div>
          <input
            type="range"
            min="70"
            max="130"
            value={Math.round(spacing.fontScale * 100)}
            onChange={(e) => handleSpacingChange('fontScale', parseInt(e.target.value, 10) / 100)}
            className="spacing-slider"
          />
        </div>

        {/* Line Height */}
        <div className="spacing-control">
          <div className="spacing-control-header">
            <label>Line Height</label>
            <span className="spacing-value">{spacing.lineHeight.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="120"
            max="180"
            value={Math.round(spacing.lineHeight * 100)}
            onChange={(e) => handleSpacingChange('lineHeight', parseInt(e.target.value, 10) / 100)}
            className="spacing-slider"
          />
        </div>

        {/* Section Spacing */}
        <div className="spacing-control">
          <div className="spacing-control-header">
            <label>Section Gap</label>
            <span className="spacing-value">{spacing.sectionSpacing.toFixed(1)} rem</span>
          </div>
          <input
            type="range"
            min="4"
            max="16"
            value={Math.round(spacing.sectionSpacing * 10)}
            onChange={(e) => handleSpacingChange('sectionSpacing', parseInt(e.target.value, 10) / 10)}
            className="spacing-slider"
          />
        </div>

        {/* Sidebar Width (for two-column layouts) */}
        <div className="spacing-control">
          <div className="spacing-control-header">
            <label>Sidebar Width</label>
            <span className="spacing-value">{spacing.sidebarWidth.toFixed(1)} in</span>
          </div>
          <input
            type="range"
            min="18"
            max="32"
            value={Math.round(spacing.sidebarWidth * 10)}
            onChange={(e) => handleSpacingChange('sidebarWidth', parseInt(e.target.value, 10) / 10)}
            className="spacing-slider"
          />
        </div>

        {/* Page Margins */}
        <div className="spacing-margins">
          <label className="spacing-margins-label">Page Margins (inches)</label>
          <div className="spacing-margins-grid">
            {['top', 'right', 'bottom', 'left'].map((side) => (
              <div className="margin-control" key={side}>
                <label>{side.charAt(0).toUpperCase() + side.slice(1)}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.2"
                  max="1.0"
                  value={spacing.pageMargins[side]}
                  onChange={(e) => handleMarginChange(side, parseFloat(e.target.value))}
                  className="margin-input"
                />
              </div>
            ))}
          </div>
        </div>
      </PanelSection>

      {/* ===== Accents ===== */}
      <PanelSection title="Accents" headerExtra={accentResetButton}>
        {/* Live Accent Preview */}
        <div className="accent-preview-card">
          <div
            className="accent-preview-title"
            data-underline={accent.underlineStyle}
            style={{ '--underline-width': `${accent.underlineWidth}px` }}
          >
            Experience
          </div>
          <div className="accent-preview-bullets">
            <div className="accent-preview-bullet">{bulletChar || ''} Led team of 5 engineers</div>
            <div className="accent-preview-bullet">{bulletChar || ''} Increased efficiency by 40%</div>
          </div>
          <div className="accent-preview-skills" data-tag-style={accent.skillTagStyle}>
            <span className="accent-skill-tag">JavaScript</span>
            <span className="accent-skill-tag">React</span>
            <span className="accent-skill-tag">Node.js</span>
          </div>
        </div>

        {/* Section Title Underline */}
        <div className="accent-control">
          <label>Title Underline</label>
          <div className="accent-options-row">
            {Object.entries(UNDERLINE_STYLES).map(([id, style]) => (
              <button
                key={id}
                className={cn('accent-option-btn', accent.underlineStyle === id && 'active')}
                type="button"
                onClick={() => handleAccentChange('underlineStyle', id)}
                title={style.name}
              >
                <span className={cn('underline-preview', id)} />
              </button>
            ))}
          </div>
        </div>

        {/* Underline Width */}
        <div className="accent-control compact">
          <div className="spacing-control-header">
            <label>Underline Width</label>
            <span className="spacing-value">{accent.underlineWidth}px</span>
          </div>
          <input
            type="range"
            min="1"
            max="4"
            value={accent.underlineWidth}
            onChange={(e) => handleAccentChange('underlineWidth', parseInt(e.target.value, 10))}
            className="spacing-slider"
          />
        </div>

        {/* Bullet Style */}
        <div className="accent-control">
          <label>Bullet Points</label>
          <div className="accent-options-row bullets">
            {Object.entries(BULLET_STYLES).map(([id, style]) => (
              <button
                key={id}
                className={cn('accent-option-btn', 'bullet', accent.bulletStyle === id && 'active')}
                type="button"
                onClick={() => handleAccentChange('bulletStyle', id)}
                title={style.name}
              >
                {id === 'none' ? <span className="bullet-none">∅</span> : style.char || '—'}
              </button>
            ))}
          </div>
        </div>

        {/* Border Radius */}
        <div className="accent-control">
          <label>Corner Rounding</label>
          <div className="accent-options-row radius">
            {Object.entries(BORDER_RADIUS_PRESETS).map(([id, preset]) => (
              <button
                key={id}
                className={cn('accent-option-btn', 'radius', accent.borderRadius === id && 'active')}
                type="button"
                onClick={() => handleAccentChange('borderRadius', id)}
                title={preset.name}
              >
                <span className="radius-preview" style={{ borderRadius: preset.value }} />
              </button>
            ))}
          </div>
        </div>

        {/* Skill Tag Style */}
        <div className="accent-control">
          <label>Skill Tags</label>
          <div className="accent-options-row tags">
            <button
              className={cn('accent-option-btn', 'tag', accent.skillTagStyle === 'plain' && 'active')}
              type="button"
              onClick={() => handleAccentChange('skillTagStyle', 'plain')}
              title="Plain (bullet-separated)"
            >
              <span className="tag-preview plain">A • B</span>
            </button>
            <button
              className={cn('accent-option-btn', 'tag', accent.skillTagStyle === 'filled' && 'active')}
              type="button"
              onClick={() => handleAccentChange('skillTagStyle', 'filled')}
              title="Filled"
            >
              <span className="tag-preview filled">Skill</span>
            </button>
            <button
              className={cn('accent-option-btn', 'tag', accent.skillTagStyle === 'outlined' && 'active')}
              type="button"
              onClick={() => handleAccentChange('skillTagStyle', 'outlined')}
              title="Outlined"
            >
              <span className="tag-preview outlined">Skill</span>
            </button>
            <button
              className={cn('accent-option-btn', 'tag', accent.skillTagStyle === 'minimal' && 'active')}
              type="button"
              onClick={() => handleAccentChange('skillTagStyle', 'minimal')}
              title="Minimal"
            >
              <span className="tag-preview minimal">Skill</span>
            </button>
          </div>
        </div>

        {/* Decorative Elements */}
        <div className="accent-control">
          <label>Decorative Elements</label>
          <div className="decorative-toggles">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={accent.showCornerTriangle !== false}
                onChange={(e) => handleAccentChange('showCornerTriangle', e.target.checked)}
              />
              <span className="toggle-label">Header corner accent</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={accent.showSidebarGradient !== false}
                onChange={(e) => handleAccentChange('showSidebarGradient', e.target.checked)}
              />
              <span className="toggle-label">Sidebar gradient overlay</span>
            </label>
          </div>
        </div>
      </PanelSection>

      {/* ===== Profile Photo ===== */}
      <PanelSection title="Profile Photo">
        {photo.enabled && photo.imageData ? (
          <>
            {/* Photo Preview & Controls */}
            <div className="photo-preview-container">
              <div className="photo-preview">
                <img src={photo.imageData} alt="Profile photo" />
                <button
                  className="photo-remove-btn"
                  type="button"
                  onClick={handleRemovePhoto}
                  title="Remove photo"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Placement */}
            <div className="photo-control">
              <label>Placement</label>
              <div className="photo-options-row">
                {Object.entries(PHOTO_PLACEMENTS).map(([id, opt]) => (
                  <button
                    key={id}
                    className={cn('photo-option-btn', photo.placement === id && 'active')}
                    type="button"
                    onClick={() => handlePhotoChange('placement', id)}
                    title={opt.description}
                  >
                    {opt.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Shape */}
            <div className="photo-control">
              <label>Shape</label>
              <div className="photo-options-row">
                {Object.entries(PHOTO_SHAPES).map(([id, shape]) => (
                  <button
                    key={id}
                    className={cn('photo-option-btn', 'shape', photo.shape === id && 'active')}
                    type="button"
                    onClick={() => handlePhotoChange('shape', id)}
                    title={shape.name}
                  >
                    <span className="shape-preview" style={{ borderRadius: shape.css }} />
                  </button>
                ))}
              </div>
            </div>

            {/* Size */}
            <div className="photo-control">
              <label>Size</label>
              <div className="photo-options-row">
                {Object.entries(PHOTO_SIZES).map(([id, size]) => (
                  <button
                    key={id}
                    className={cn('photo-option-btn', photo.size === id && 'active')}
                    type="button"
                    onClick={() => handlePhotoChange('size', id)}
                  >
                    {size.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Border */}
            <div className="photo-control">
              <label>Border</label>
              <div className="photo-options-row">
                <button
                  className={cn('photo-option-btn', photo.borderColor === 'accent' && 'active')}
                  type="button"
                  onClick={() => handlePhotoChange('borderColor', 'accent')}
                >
                  Accent
                </button>
                <button
                  className={cn('photo-option-btn', photo.borderColor === 'white' && 'active')}
                  type="button"
                  onClick={() => handlePhotoChange('borderColor', 'white')}
                >
                  White
                </button>
                <button
                  className={cn('photo-option-btn', photo.borderColor === 'none' && 'active')}
                  type="button"
                  onClick={() => handlePhotoChange('borderColor', 'none')}
                >
                  None
                </button>
              </div>
            </div>

            {/* Image Position (Crop Focus) */}
            <div className="photo-control">
              <label>Image Focus</label>
              <div className="photo-position-grid">
                {[
                  'left top',
                  'center top',
                  'right top',
                  'left center',
                  'center center',
                  'right center',
                  'left bottom',
                  'center bottom',
                  'right bottom',
                ].map((pos) => {
                  const titles = {
                    'left top': 'Top Left',
                    'center top': 'Top Center',
                    'right top': 'Top Right',
                    'left center': 'Middle Left',
                    'center center': 'Center',
                    'right center': 'Middle Right',
                    'left bottom': 'Bottom Left',
                    'center bottom': 'Bottom Center',
                    'right bottom': 'Bottom Right',
                  };
                  return (
                    <button
                      key={pos}
                      className={cn(
                        'photo-position-btn',
                        (photo.objectPosition || 'center center') === pos && 'active',
                      )}
                      type="button"
                      onClick={() => handlePhotoChange('objectPosition', pos)}
                      title={titles[pos]}
                    >
                      <span className="pos-dot" />
                    </button>
                  );
                })}
              </div>
              <p className="photo-hint">Choose which part of the image to focus on</p>
            </div>

            {/* Zoom */}
            <div className="photo-control">
              <div className="spacing-control-header">
                <label>Zoom</label>
                <span className="spacing-value">{Math.round((photo.scale || 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="100"
                max="200"
                value={Math.round((photo.scale || 1) * 100)}
                onChange={(e) => handlePhotoChange('scale', parseFloat(e.target.value) / 100)}
                className="spacing-slider"
              />
            </div>
          </>
        ) : (
          /* Upload Dropzone */
          <label
            className="photo-upload-dropzone"
            onDragOver={onDropzoneDragOver}
            onDragLeave={onDropzoneDragLeave}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove('dragover');
              const file = e.dataTransfer.files[0];
              if (file && file.type.startsWith('image/')) handlePhotoFile(file);
            }}
          >
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handlePhotoFile(e.target.files[0])}
            />
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="8" r="4" />
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            </svg>
            <p>Add Profile Photo</p>
            <span>Click or drag image here</span>
          </label>
        )}
      </PanelSection>
    </>
  );
}
