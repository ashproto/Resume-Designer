/**
 * Validate the document shape before it can become the saved/open résumé.
 * Optional fields stay optional for older exports, and unknown metadata stays
 * untouched. In particular, do not repair malformed lists by discarding their
 * contents: the original file or saved variant must remain recoverable.
 */
export function assertResumeData(data, { requireIdentity = false } = {}) {
  const fail = (path, shape) => {
    throw new Error(`Invalid resume: ${path} must be ${shape}.`);
  };
  const object = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'an object');
  };
  const textFields = (value, fields, prefix = '') => {
    for (const field of fields) {
      if (value[field] != null && typeof value[field] !== 'string') {
        fail(`${prefix}${field}`, 'text');
      }
    }
  };
  const list = (value, path, check) => {
    if (value == null) return;
    if (!Array.isArray(value)) fail(path, 'a list');
    value.forEach((item, index) => check(item, `${path}[${index}]`));
  };
  const text = (value, path) => {
    if (typeof value !== 'string') fail(path, 'text');
  };

  object(data, 'document');
  textFields(data, ['name', 'tagline', 'summary']);
  if (requireIdentity && (typeof data.name !== 'string' || !data.name.trim())) {
    fail('name', 'non-empty text');
  }
  if (requireIdentity || data.contact != null) {
    object(data.contact, 'contact');
    textFields(data.contact,
      ['location', 'email', 'phone', 'portfolio', 'instagram', 'linkedin', 'github', 'twitter'],
      'contact.');
  }
  list(data.education, 'education', text);
  list(data.sections, 'sections', (section, path) => {
    object(section, path);
    textFields(section, ['id', 'title', 'type', 'area'], `${path}.`);
    // Older documents and the native editor also support one scalar prose
    // field. Its type is optional; preserve its shape and validate every item
    // only when the content is list-backed.
    if (typeof section.content !== 'string') list(section.content, `${path}.content`, text);
  });
  list(data.experience, 'experience', (entry, path) => {
    object(entry, path);
    textFields(entry,
      ['id', 'title', 'company', 'location', 'dates', 'startDate', 'endDate', '_groupId'],
      `${path}.`);
    list(entry.bullets, `${path}.bullets`, text);
  });
  // Both forms are supported by older exports and every current renderer.
  if (data.tools != null && typeof data.tools !== 'string') list(data.tools, 'tools', text);
}
