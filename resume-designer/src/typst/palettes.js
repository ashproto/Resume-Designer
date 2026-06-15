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
