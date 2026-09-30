/**
 * What a résumé-data blob holds before anything has been saved into it — the
 * shape `loadFromStorage` fills in for a workspace whose blob is not on disk
 * yet, and the fallback `getSettings` / `getUserProfile` read for a missing
 * field.
 *
 * A LEAF, and that is why it is a file of its own: the sync layer has to know
 * what a filled-in default looks like — writing one is not an edit (see
 * `changedDataUnits` in src/sync/syncModel.js) — and it must not import
 * persistence.js, whose graph edge main.js owns.
 *
 * Callers that keep what they read must clone it (`structuredClone`), as
 * `loadFromStorage` does: these nested objects are shared module state.
 */

export const DEFAULT_STORAGE = {
  variants: {},
  currentVariantId: null,
  settings: {
    colorPalette: 'terracotta',
    layout: 'sidebar',
    pageSize: 'continuous',
    orientation: 'portrait',
    pageWidthIn: 8.5,
    customColor: '#c45c3e',
    autoFallback: false,
    defaultModel: 'anthropic/claude-sonnet-4.6',
    customModels: [],
    chatPanelWidth: 320,
    chatReasoningEffort: 'medium',
    chatWebSearch: false,
    analysisModel: '',
    analysisReasoning: 'medium',
    tailorModel: '',
    tailorReasoning: 'medium',
    onboardingModel: '',
    onboardingReasoning: 'medium'
  },
  userProfile: {
    // Contact information
    contactInfo: {
      fullName: '',
      email: '',
      phone: '',
      location: '',
      linkedin: '',
      portfolio: '',
      github: '',
      twitter: '',
      instagram: ''
    },
    personalSummary: '',
    careerGoals: '',
    workExperience: [],
    skills: [],
    education: [],
    projects: [],
    certifications: [],
    achievements: [],
    industryKnowledge: '',
    preferences: '',
    customSections: []
  }
};
