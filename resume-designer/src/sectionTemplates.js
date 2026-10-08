// Shared section choices for the desktop and native editors.
export const SECTION_TEMPLATES = {
  skills: { title: 'Skills', type: 'list', content: ['Skill 1', 'Skill 2', 'Skill 3'] },
  highlights: { title: 'Highlights', type: 'list', content: ['- Key achievement 1', '- Key achievement 2'] },
  languages: { title: 'Languages', type: 'list', content: ['English (Native)', 'Spanish (Conversational)'] },
  certifications: { title: 'Certifications', type: 'list', content: ['Certification Name — Year'] },
  interests: { title: 'Interests', type: 'list', content: ['Interest 1', 'Interest 2'] },
  projects: { title: 'Projects', type: 'list', content: ['Project name — Describe your contribution and its outcome.'] },
  awards: { title: 'Awards', type: 'list', content: ['Award name — Organization — Year'] },
  publications: { title: 'Publications', type: 'list', content: ['Publication title — Publisher — Year'] },
  volunteering: { title: 'Volunteering', type: 'list', content: ['Role — Organization — Describe your contribution.'] },
};

export const SECTION_AREAS = [
  { id: 'main', name: 'Main content' },
  { id: 'sidebar', name: 'Sidebar' },
];
