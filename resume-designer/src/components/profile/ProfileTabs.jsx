import { cn } from '@/lib/utils';

// The profile editor's tab definitions + content. Forms reuse the existing
// `.profile-*` CSS for a pixel-faithful conversion. Inputs are UNCONTROLLED
// (defaultValue) and write straight into the working `profile` object on change,
// so typing never re-renders (caret-safe). Add/delete call `refresh()`, which
// the parent uses to bump a remount key so the list reflects the change.

export function TabIcon({ icon }) {
  switch (icon) {
    case 'contact':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
    case 'user':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case 'briefcase':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>;
    case 'star':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
    case 'book':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
    case 'folder':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    case 'plus':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>;
    default:
      return null;
  }
}

const PlusIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
const CloseIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function Field({ label, type = 'text', value, placeholder, onCommit }) {
  return (
    <div className="profile-input-group">
      {label && <label>{label}</label>}
      <input
        type={type}
        className="profile-input"
        placeholder={placeholder}
        defaultValue={value || ''}
        onChange={(e) => onCommit(e.target.value)}
      />
    </div>
  );
}

function Area({ label, hint, value, placeholder, rows = 4, onCommit }) {
  return (
    <div className="profile-section">
      {(label || hint) && (
        <div className="profile-section-header">
          {label && <h3>{label}</h3>}
          {hint && <p className="profile-section-hint">{hint}</p>}
        </div>
      )}
      <textarea
        className="profile-textarea"
        placeholder={placeholder}
        rows={rows}
        defaultValue={value || ''}
        onChange={(e) => onCommit(e.target.value)}
      />
    </div>
  );
}

function AddButton({ onClick, children, small }) {
  return (
    <button className={cn('profile-add-btn', small && 'small')} type="button" onClick={onClick}>
      <PlusIcon size={small ? 14 : 16} />
      {children}
    </button>
  );
}

function Empty({ title, subtitle, small }) {
  return (
    <div className={cn('profile-empty', small && 'small')}>
      <p>{title}</p>
      {subtitle && <span>{subtitle}</span>}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────

function ContactTab({ profile, scheduleSave }) {
  const c = profile.contactInfo;
  const set = (field) => (value) => { c[field] = value; scheduleSave(); };
  return (
    <>
      <div className="profile-section">
        <div className="profile-section-header">
          <h3>Basic Information</h3>
          <p className="profile-section-hint">Your name and contact details for resumes</p>
        </div>
        <div className="profile-contact-grid">
          <Field label="Full Name" value={c.fullName} placeholder="e.g. John Smith" onCommit={set('fullName')} />
          <Field label="Email" type="email" value={c.email} placeholder="e.g. john@example.com" onCommit={set('email')} />
          <Field label="Phone" type="tel" value={c.phone} placeholder="e.g. (555) 123-4567" onCommit={set('phone')} />
          <Field label="Location" value={c.location} placeholder="e.g. San Francisco, CA" onCommit={set('location')} />
        </div>
      </div>
      <div className="profile-section">
        <div className="profile-section-header">
          <h3>Online Presence</h3>
          <p className="profile-section-hint">Links to your professional profiles and portfolio</p>
        </div>
        <div className="profile-contact-grid">
          <div className="profile-input-group">
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
              LinkedIn
            </label>
            <input type="url" className="profile-input" placeholder="e.g. linkedin.com/in/johnsmith" defaultValue={c.linkedin || ''} onChange={(e) => set('linkedin')(e.target.value)} />
          </div>
          <div className="profile-input-group">
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
              Portfolio / Website
            </label>
            <input type="url" className="profile-input" placeholder="e.g. johnsmith.com" defaultValue={c.portfolio || ''} onChange={(e) => set('portfolio')(e.target.value)} />
          </div>
          <div className="profile-input-group">
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
              GitHub
            </label>
            <input type="url" className="profile-input" placeholder="e.g. github.com/johnsmith" defaultValue={c.github || ''} onChange={(e) => set('github')(e.target.value)} />
          </div>
          <div className="profile-input-group">
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
              Twitter / X
            </label>
            <input type="url" className="profile-input" placeholder="e.g. twitter.com/johnsmith" defaultValue={c.twitter || ''} onChange={(e) => set('twitter')(e.target.value)} />
          </div>
          <div className="profile-input-group">
            <label>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
              Instagram
            </label>
            <input type="url" className="profile-input" placeholder="e.g. instagram.com/johnsmith" defaultValue={c.instagram || ''} onChange={(e) => set('instagram')(e.target.value)} />
          </div>
        </div>
      </div>
    </>
  );
}

function SummaryTab({ profile, scheduleSave }) {
  const set = (field) => (value) => { profile[field] = value; scheduleSave(); };
  return (
    <>
      <Area label="Personal Summary" hint="Tell the AI who you are professionally. What makes you unique?" rows={6}
        value={profile.personalSummary} onCommit={set('personalSummary')}
        placeholder="Example: I'm a passionate UX designer with 8 years of experience in fintech and healthcare. I specialize in complex data visualization and have led design systems initiatives at two Fortune 500 companies..." />
      <Area label="Career Goals" hint="What are you looking for? What roles interest you?"
        value={profile.careerGoals} onCommit={set('careerGoals')}
        placeholder="Example: I'm seeking a senior or lead UX position at a company focused on AI/ML products. I want to transition into more strategic work while still being hands-on with design..." />
      <Area label="Preferences" hint="Work style, industries, salary expectations, location preferences, etc."
        value={profile.preferences} onCommit={set('preferences')}
        placeholder="Example: Remote-first, interested in Series B+ startups or established tech companies. Open to contract work. Prefer collaborative environments with strong design culture..." />
    </>
  );
}

// Generic add/delete list with a title input + delete button per item.
function ItemList({ items, emptyTitle, emptySubtitle, addLabel, onAdd, onDelete, renderItem }) {
  return (
    <div className="profile-items">
      {items.length === 0 ? (
        <Empty title={emptyTitle} subtitle={emptySubtitle} />
      ) : (
        items.map((item, i) => (
          <div className="profile-item" key={i}>
            <div className="profile-item-header">
              {renderItem.title(item, i)}
              <button className="profile-item-delete" type="button" title="Delete" onClick={() => onDelete(i)}>
                <TrashIcon />
              </button>
            </div>
            {renderItem.body(item, i)}
          </div>
        ))
      )}
      <AddButton onClick={onAdd}>{addLabel}</AddButton>
    </div>
  );
}

function ExperienceTab({ profile, scheduleSave, refresh }) {
  const items = profile.workExperience;
  const set = (i, field) => (v) => { items[i][field] = v; scheduleSave(); };
  return (
    <div className="profile-section">
      <div className="profile-section-header">
        <h3>Detailed Work Experience</h3>
        <p className="profile-section-hint">Add details beyond what&apos;s on your resume - challenges faced, technologies used, team size, impact metrics, lessons learned.</p>
      </div>
      <ItemList
        items={items}
        emptyTitle="No experience entries yet"
        emptySubtitle="Add detailed information about your work history"
        addLabel="Add Experience Entry"
        onAdd={() => { items.push({ title: '', company: '', dates: '', details: '' }); refresh(); }}
        onDelete={(i) => { items.splice(i, 1); refresh(); }}
        renderItem={{
          title: (exp, i) => <input type="text" className="profile-input profile-item-title" placeholder="Job Title" defaultValue={exp.title || ''} onChange={(e) => set(i, 'title')(e.target.value)} />,
          body: (exp, i) => (
            <>
              <input type="text" className="profile-input" placeholder="Company" defaultValue={exp.company || ''} onChange={(e) => set(i, 'company')(e.target.value)} />
              <input type="text" className="profile-input" placeholder="Dates (e.g., Jan 2020 - Present)" defaultValue={exp.dates || ''} onChange={(e) => set(i, 'dates')(e.target.value)} />
              <textarea className="profile-textarea" rows="4" placeholder="Describe this role in detail: what did you accomplish? What challenges did you overcome? What technologies did you use? What was your team like?" defaultValue={exp.details || ''} onChange={(e) => set(i, 'details')(e.target.value)} />
            </>
          ),
        }}
      />
    </div>
  );
}

function SkillsTab({ profile, scheduleSave, refresh }) {
  const skills = profile.skills;
  const set = (i, field) => (v) => { skills[i][field] = v; scheduleSave(); };
  return (
    <>
      <div className="profile-section">
        <div className="profile-section-header">
          <h3>Skills Inventory</h3>
          <p className="profile-section-hint">List all your skills with proficiency levels and years of experience.</p>
        </div>
        <div className="profile-skills-grid">
          {skills.length === 0 ? (
            <Empty title="No skills added yet" subtitle="Add your skills with proficiency levels" />
          ) : (
            skills.map((skill, i) => (
              <div className="profile-skill-item" key={i}>
                <input type="text" className="profile-input skill-name" placeholder="Skill name" defaultValue={skill.name || ''} onChange={(e) => set(i, 'name')(e.target.value)} />
                <select className="profile-select skill-level" defaultValue={skill.proficiency || ''} onChange={(e) => set(i, 'proficiency')(e.target.value)}>
                  <option value="">Proficiency</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                  <option value="expert">Expert</option>
                </select>
                <input type="text" className="profile-input skill-years" placeholder="Years" defaultValue={skill.years || ''} onChange={(e) => set(i, 'years')(e.target.value)} />
                <button className="profile-skill-delete" type="button" title="Delete" onClick={() => { skills.splice(i, 1); refresh(); }}>
                  <CloseIcon />
                </button>
              </div>
            ))
          )}
          <AddButton onClick={() => { skills.push({ name: '', proficiency: '', years: '' }); refresh(); }}>Add Skill</AddButton>
        </div>
      </div>
      <Area label="Industry Knowledge" hint="Domains you've worked in, tools mastered, methodologies you follow."
        value={profile.industryKnowledge} onCommit={(v) => { profile.industryKnowledge = v; scheduleSave(); }}
        placeholder="Example: Deep expertise in e-commerce, SaaS, and mobile app design. Familiar with Agile/Scrum, Design Thinking, and Jobs-to-be-Done frameworks. Strong knowledge of accessibility standards (WCAG 2.1)..." />
    </>
  );
}

function EducationTab({ profile, scheduleSave, refresh }) {
  const items = profile.education;
  const set = (i, field) => (v) => { items[i][field] = v; scheduleSave(); };
  return (
    <div className="profile-section">
      <div className="profile-section-header">
        <h3>Education Details</h3>
        <p className="profile-section-hint">Include courses, projects, thesis topics, honors, extracurriculars - details beyond a typical resume.</p>
      </div>
      <ItemList
        items={items}
        emptyTitle="No education entries yet"
        emptySubtitle="Add detailed information about your education"
        addLabel="Add Education Entry"
        onAdd={() => { items.push({ degree: '', institution: '', dates: '', details: '' }); refresh(); }}
        onDelete={(i) => { items.splice(i, 1); refresh(); }}
        renderItem={{
          title: (edu, i) => <input type="text" className="profile-input profile-item-title" placeholder="Degree / Program" defaultValue={edu.degree || ''} onChange={(e) => set(i, 'degree')(e.target.value)} />,
          body: (edu, i) => (
            <>
              <input type="text" className="profile-input" placeholder="Institution" defaultValue={edu.institution || ''} onChange={(e) => set(i, 'institution')(e.target.value)} />
              <input type="text" className="profile-input" placeholder="Dates / Year" defaultValue={edu.dates || ''} onChange={(e) => set(i, 'dates')(e.target.value)} />
              <textarea className="profile-textarea" rows="3" placeholder="Notable courses, projects, thesis, honors, activities, GPA if relevant..." defaultValue={edu.details || ''} onChange={(e) => set(i, 'details')(e.target.value)} />
            </>
          ),
        }}
      />
    </div>
  );
}

function ProjectsTab({ profile, scheduleSave, refresh }) {
  const items = profile.projects;
  const set = (i, field) => (v) => { items[i][field] = v; scheduleSave(); };
  return (
    <div className="profile-section">
      <div className="profile-section-header">
        <h3>Portfolio &amp; Projects</h3>
        <p className="profile-section-hint">Personal projects, open source contributions, side work, freelance projects - anything that showcases your abilities.</p>
      </div>
      <ItemList
        items={items}
        emptyTitle="No projects added yet"
        emptySubtitle="Add projects that showcase your work"
        addLabel="Add Project"
        onAdd={() => { items.push({ name: '', url: '', description: '' }); refresh(); }}
        onDelete={(i) => { items.splice(i, 1); refresh(); }}
        renderItem={{
          title: (proj, i) => <input type="text" className="profile-input profile-item-title" placeholder="Project Name" defaultValue={proj.name || ''} onChange={(e) => set(i, 'name')(e.target.value)} />,
          body: (proj, i) => (
            <>
              <input type="text" className="profile-input" placeholder="URL (optional)" defaultValue={proj.url || ''} onChange={(e) => set(i, 'url')(e.target.value)} />
              <textarea className="profile-textarea" rows="4" placeholder="Describe the project: what problem does it solve? What technologies did you use? What was your role? What was the outcome?" defaultValue={proj.description || ''} onChange={(e) => set(i, 'description')(e.target.value)} />
            </>
          ),
        }}
      />
    </div>
  );
}

function MoreTab({ profile, scheduleSave, refresh }) {
  const certs = profile.certifications;
  const achs = profile.achievements;
  const customs = profile.customSections;
  return (
    <>
      <div className="profile-section">
        <div className="profile-section-header">
          <h3>Certifications &amp; Training</h3>
          <p className="profile-section-hint">Professional certifications, courses, training programs.</p>
        </div>
        <div className="profile-items">
          {certs.length === 0 ? <Empty small title="No certifications added" /> : certs.map((cert, i) => (
            <div className="profile-item compact" key={i}>
              <div className="profile-item-row">
                <input type="text" className="profile-input" placeholder="Certification name" defaultValue={cert.name || ''} onChange={(e) => { certs[i].name = e.target.value; scheduleSave(); }} />
                <input type="text" className="profile-input small" placeholder="Year" defaultValue={cert.year || ''} onChange={(e) => { certs[i].year = e.target.value; scheduleSave(); }} />
                <button className="profile-item-delete-small" type="button" title="Delete" onClick={() => { certs.splice(i, 1); refresh(); }}><CloseIcon /></button>
              </div>
            </div>
          ))}
          <AddButton small onClick={() => { certs.push({ name: '', year: '' }); refresh(); }}>Add Certification</AddButton>
        </div>
      </div>

      <div className="profile-section">
        <div className="profile-section-header">
          <h3>Achievements &amp; Awards</h3>
          <p className="profile-section-hint">Notable accomplishments, recognition, awards.</p>
        </div>
        <div className="profile-items">
          {achs.length === 0 ? <Empty small title="No achievements added" /> : achs.map((ach, i) => (
            <div className="profile-item compact" key={i}>
              <div className="profile-item-row">
                <input type="text" className="profile-input" placeholder="Achievement description" defaultValue={ach.description || ''} onChange={(e) => { achs[i].description = e.target.value; scheduleSave(); }} />
                <button className="profile-item-delete-small" type="button" title="Delete" onClick={() => { achs.splice(i, 1); refresh(); }}><CloseIcon /></button>
              </div>
            </div>
          ))}
          <AddButton small onClick={() => { achs.push({ description: '' }); refresh(); }}>Add Achievement</AddButton>
        </div>
      </div>

      <div className="profile-section">
        <div className="profile-section-header">
          <h3>Custom Sections</h3>
          <p className="profile-section-hint">Add any other information you want the AI to know about.</p>
        </div>
        <div className="profile-items">
          {customs.length === 0 ? <Empty small title="No custom sections added" /> : customs.map((sec, i) => (
            <div className="profile-item" key={i}>
              <div className="profile-item-header">
                <input type="text" className="profile-input profile-item-title" placeholder="Section Title" defaultValue={sec.title || ''} onChange={(e) => { customs[i].title = e.target.value; scheduleSave(); }} />
                <button className="profile-item-delete" type="button" title="Delete" onClick={() => { customs.splice(i, 1); refresh(); }}><TrashIcon /></button>
              </div>
              <textarea className="profile-textarea" rows="3" placeholder="Content..." defaultValue={sec.content || ''} onChange={(e) => { customs[i].content = e.target.value; scheduleSave(); }} />
            </div>
          ))}
          <AddButton small onClick={() => { customs.push({ title: '', content: '' }); refresh(); }}>Add Custom Section</AddButton>
        </div>
      </div>
    </>
  );
}

const TAB_COMPONENTS = {
  contact: ContactTab,
  summary: SummaryTab,
  experience: ExperienceTab,
  skills: SkillsTab,
  education: EducationTab,
  projects: ProjectsTab,
  more: MoreTab,
};

export function ProfileTabContent({ tab, ...props }) {
  const Component = TAB_COMPONENTS[tab] || ContactTab;
  return <Component {...props} />;
}
