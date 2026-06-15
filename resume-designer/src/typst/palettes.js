// The 12 résumé color palettes — single source of truth, imported by both the
// renderer (main.js) and the Typst theme bridge (typst/theme.js) so colors can't
// drift between the on-screen render and the PDF.
export const COLOR_PALETTES = {
  terracotta: { accent: '#c45c3e', accentLight: '#d97a5d', headerBg: '#2d2a26', headerBgEnd: '#3d3832', sidebarBg: '#f4e8e4' },
  rose:       { accent: '#e11d48', accentLight: '#f43f5e', headerBg: '#4a1025', headerBgEnd: '#5a2035', sidebarBg: '#fce7f3' },
  amber:      { accent: '#d97706', accentLight: '#f59e0b', headerBg: '#451a03', headerBgEnd: '#78350f', sidebarBg: '#fef3c7' },
  coral:      { accent: '#f97316', accentLight: '#fb923c', headerBg: '#431407', headerBgEnd: '#7c2d12', sidebarBg: '#ffedd5' },
  ocean:      { accent: '#2563eb', accentLight: '#3b82f6', headerBg: '#1e3a5f', headerBgEnd: '#2d4a6f', sidebarBg: '#e8f0fe' },
  teal:       { accent: '#0d9488', accentLight: '#14b8a6', headerBg: '#134e4a', headerBgEnd: '#115e59', sidebarBg: '#ccfbf1' },
  forest:     { accent: '#059669', accentLight: '#10b981', headerBg: '#1a3c34', headerBgEnd: '#2a4c44', sidebarBg: '#e6f4f0' },
  cyan:       { accent: '#0891b2', accentLight: '#06b6d4', headerBg: '#164e63', headerBgEnd: '#155e75', sidebarBg: '#cffafe' },
  plum:       { accent: '#7c3aed', accentLight: '#8b5cf6', headerBg: '#2d1f47', headerBgEnd: '#3d2f57', sidebarBg: '#f3e8ff' },
  indigo:     { accent: '#4f46e5', accentLight: '#6366f1', headerBg: '#1e1b4b', headerBgEnd: '#312e81', sidebarBg: '#e0e7ff' },
  slate:      { accent: '#64748b', accentLight: '#94a3b8', headerBg: '#1e293b', headerBgEnd: '#334155', sidebarBg: '#f1f5f9' },
  zinc:       { accent: '#52525b', accentLight: '#71717a', headerBg: '#18181b', headerBgEnd: '#27272a', sidebarBg: '#f4f4f5' },
};

// Convert hex to HSL
function hexToHSL(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

// Convert HSL to hex
function hslToHex({ h, s, l }) {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;

  let r, g, b;

  if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0; }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x; }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c; }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  r = Math.round((r + m) * 255).toString(16).padStart(2, '0');
  g = Math.round((g + m) * 255).toString(16).padStart(2, '0');
  b = Math.round((b + m) * 255).toString(16).padStart(2, '0');

  return `#${r}${g}${b}`;
}

// Generate a full palette from a single accent color
export function generatePaletteFromColor(hexColor) {
  const hsl = hexToHSL(hexColor);

  // Generate accent light (slightly lighter and more saturated)
  const accentLightHSL = {
    h: hsl.h,
    s: Math.min(hsl.s + 10, 100),
    l: Math.min(hsl.l + 15, 85)
  };

  // Generate header background (dark, desaturated version)
  const headerBgHSL = {
    h: hsl.h,
    s: Math.max(hsl.s - 20, 10),
    l: 15
  };

  // Generate header background end (slightly lighter)
  const headerBgEndHSL = {
    h: hsl.h,
    s: Math.max(hsl.s - 15, 15),
    l: 22
  };

  // Generate sidebar background (very light tint)
  const sidebarBgHSL = {
    h: hsl.h,
    s: Math.min(hsl.s * 0.4, 30),
    l: 95
  };

  return {
    accent: hexColor,
    accentLight: hslToHex(accentLightHSL),
    headerBg: hslToHex(headerBgHSL),
    headerBgEnd: hslToHex(headerBgEndHSL),
    sidebarBg: hslToHex(sidebarBgHSL)
  };
}
