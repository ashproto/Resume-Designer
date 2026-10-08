import { isSensitiveDescriptor, isSensitiveQuestion } from '../sensitivity.js';

export const FIELD_ID_ATTRIBUTE = 'data-resume-designer-field-id';
export const MAX_JOB_DESCRIPTION_CHARS = 65_536;

const IGNORED_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  'password',
]);
const TEXT_INPUT_TYPES = new Set([
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'search',
  'tel',
  'text',
  'time',
  'url',
  'week',
]);

function normalize(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function accessibleLabelText(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(node => node.remove());
  return normalize(clone.textContent);
}

function associatedLabel(element) {
  return [...(element.labels ?? [])]
    .map(accessibleLabelText)
    .filter(Boolean)
    .join(' ');
}

function ariaLabelledBy(element) {
  const document = element.ownerDocument;
  return normalize(element.getAttribute('aria-labelledby'))
    .split(' ')
    .map((id) => accessibleLabelText(document.getElementById(id)))
    .filter(Boolean)
    .join(' ');
}

function ownAriaLabel(element) {
  return normalize(element.getAttribute('aria-label')) || ariaLabelledBy(element);
}

function groupLabel(element) {
  let ancestor = element.parentElement;

  while (ancestor) {
    if (ancestor.tagName === 'FIELDSET') {
      const legend = [...ancestor.children].find((child) => child.tagName === 'LEGEND');
      const label = normalize(legend?.textContent);
      if (label) return label;
    }

    if (normalize(ancestor.getAttribute('role')).toLowerCase() === 'group') {
      const label = ownAriaLabel(ancestor);
      if (label) return label;
    }

    if (ancestor.tagName === 'FORM' || ancestor.tagName === 'BODY') break;
    ancestor = ancestor.parentElement;
  }

  return '';
}

function labelledGroupContainer(element) {
  let ancestor = element.parentElement;

  while (ancestor) {
    if (ancestor.tagName === 'FIELDSET') {
      const legend = [...ancestor.children].find((child) => child.tagName === 'LEGEND');
      if (normalize(legend?.textContent)) return ancestor;
    }

    if (normalize(ancestor.getAttribute('role')).toLowerCase() === 'group') {
      if (ownAriaLabel(ancestor)) return ancestor;
    }

    if (ancestor.tagName === 'FORM' || ancestor.tagName === 'BODY') break;
    ancestor = ancestor.parentElement;
  }

  return null;
}

function textWithoutControls(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('input, textarea, select, option, button, script, style, [role="combobox"], .select2-container, .AutocompleteSelectFieldUIWidget, [hidden], [aria-hidden="true"]')
    .forEach((control) => control.remove());
  return normalize(clone.textContent);
}

function isGenericUploadLabel(label) {
  return /^(attach|upload)(?: file)?$/i.test(normalize(label));
}

function containingFieldText(element, skipGenericUpload = false) {
  let ancestor = element.parentElement;

  while (ancestor && !['FORM', 'BODY', 'HTML'].includes(ancestor.tagName)) {
    const text = textWithoutControls(ancestor);
    if (text && (!skipGenericUpload || !isGenericUploadLabel(text))) return text;
    ancestor = ancestor.parentElement;
  }

  return '';
}

function primaryLabel(element) {
  return associatedLabel(element)
    || normalize(element.getAttribute('aria-label'))
    || ariaLabelledBy(element)
    || normalize(element.getAttribute('placeholder'));
}

function labelFor(element, type) {
  const primary = primaryLabel(element);
  const grouped = groupLabel(element);

  if (type === 'file' && isGenericUploadLabel(primary) && grouped) return grouped;

  return primary
    || grouped
    || containingFieldText(element, type === 'file')
    || normalize(element.getAttribute('name'))
    || normalize(element.id);
}

function isRequired(element) {
  return Boolean(element.required)
    || normalize(element.getAttribute('aria-required')).toLowerCase() === 'true';
}

function inputType(element) {
  return normalize(element.getAttribute('type') || 'text').toLowerCase();
}

export function isButtonBackedYesNoCheckbox(element) {
  if (
    element.tagName !== 'INPUT'
    || inputType(element) !== 'checkbox'
    || element.getAttribute('tabindex') !== '-1'
    || primaryLabel(element)
  ) {
    return false;
  }

  const container = element.parentElement;
  if (!container || ['FORM', 'BODY', 'HTML'].includes(container.tagName)) return false;

  const fields = [...container.querySelectorAll('input, textarea, select, [role="combobox"]')];
  if (fields.length !== 1 || fields[0] !== element) return false;

  const buttonLabels = [...container.children]
    .filter((child) => child.tagName === 'BUTTON')
    .map((button) => normalize(button.textContent).toLowerCase());

  return buttonLabels.length === 2
    && buttonLabels.includes('yes')
    && buttonLabels.includes('no');
}

function descriptorType(element) {
  if (normalize(element.getAttribute('role')).toLowerCase() === 'combobox') return 'custom';
  if (element.matches('.select2-container, .AutocompleteSelectFieldUIWidget')) return 'custom';
  if (isButtonBackedYesNoCheckbox(element)) return 'custom';
  if (element.tagName === 'TEXTAREA') return 'textarea';
  if (element.tagName === 'SELECT') return 'select';

  const type = inputType(element);
  if (type === 'radio' || type === 'checkbox' || type === 'file') return type;
  return 'text';
}

export function isUnavailableControl(element) {
  if (element.matches(':disabled') || element.hasAttribute('disabled') || (element.readOnly && element.getAttribute('role') !== 'combobox')) return true;
  if (normalize(element.getAttribute('aria-disabled')).toLowerCase() === 'true') return true;
  if (element.closest('[inert]')) return true;
  // Upload widgets may hide the native input itself, but an inactive containing
  // step must stay untouched just like it would for every other control.
  const isFile = element.tagName === 'INPUT' && inputType(element) === 'file';
  const visibilityRoot = isFile ? element.parentElement : element;
  if (visibilityRoot?.closest('[hidden], [aria-hidden="true"]')) return true;
  const view = element.ownerDocument?.defaultView;
  for (let node = visibilityRoot; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (style?.display === 'none' || ['hidden', 'collapse'].includes(style?.visibility)) return true;
  }
  return false;
}

function isIgnored(element) {
  if (isUnavailableControl(element)) return true;
  // A widget's search box is not the applicant's answer. Select2 can mount it
  // in a popup outside the widget itself, so nesting alone is not sufficient.
  if (element.matches('input.select2-input, input.select2-search__field')) return true;
  if (element.tagName !== 'INPUT') return false;

  const type = inputType(element);
  if (IGNORED_INPUT_TYPES.has(type)) return true;
  if (normalize(element.getAttribute('role')).toLowerCase() === 'combobox') return false;
  return !TEXT_INPUT_TYPES.has(type) && !['radio', 'checkbox', 'file'].includes(type);
}

function hasFileIdentity(element) {
  return Boolean(
    associatedLabel(element)
    || ownAriaLabel(element)
    || normalize(element.getAttribute('placeholder'))
    || groupLabel(element)
    || normalize(element.getAttribute('name'))
    || normalize(element.id),
  );
}

function createFieldId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `rd-field-${uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function markerFor(elements) {
  const existing = elements
    .map((element) => normalize(element.getAttribute(FIELD_ID_ATTRIBUTE)))
    .find(Boolean);
  const fieldId = existing || createFieldId();

  for (const element of elements) element.setAttribute(FIELD_ID_ATTRIBUTE, fieldId);
  return fieldId;
}

function selectOptions(element) {
  return [...element.options].filter((option) => !option.disabled && !option.closest('optgroup[disabled]')).map((option) => ({
    value: String(option.value),
    label: normalize(option.label || option.textContent),
  }));
}

function radioOptionLabel(element) {
  return primaryLabel(element)
    || normalize(element.getAttribute('name'))
    || normalize(element.id)
    || normalize(element.value);
}

function radioDescriptor(elements) {
  const first = elements[0];
  const grouped = groupLabel(first);
  const options = elements.map((element) => {
    const label = radioOptionLabel(element);
    const value = !element.hasAttribute('value') || element.value === 'on'
      ? label
      : String(element.value);
    return { value, label };
  });

  return {
    field_id: markerFor(elements),
    label: grouped || labelFor(first, 'radio'),
    type: 'radio',
    options,
    required: elements.some(isRequired),
  };
}

function controlDescriptor(element) {
  const type = descriptorType(element);
  const grouped = groupLabel(element);
  const baseLabel = labelFor(element, type);
  const label = type === 'checkbox' && grouped && baseLabel !== grouped
    ? `${grouped}: ${baseLabel}`
    : baseLabel;

  return {
    field_id: markerFor([element]),
    label,
    type,
    options: type === 'select' ? selectOptions(element) : [],
    required: isRequired(element),
    ...(element.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(inputType(element)) && inputType(element) !== 'text' ? { inputType: inputType(element) } : {}),
    ...(Number.isInteger(element.maxLength) && element.maxLength >= 0 ? { maxLength: element.maxLength } : {}),
    ...(type === 'file' && element.accept ? { accept: element.accept } : {}),
  };
}

export function isSensitiveControl(element) {
  return isSensitiveDescriptor(controlDescriptorWithoutMarker(element))
    || isSensitiveQuestion(groupLabel(element))
    || isSensitiveQuestion(element.getAttribute('name'))
    || isSensitiveQuestion(element.getAttribute('autocomplete'));
}

function controlDescriptorWithoutMarker(element) {
  const type = descriptorType(element);
  return {
    label: labelFor(element, type),
    options: element.tagName === 'SELECT' ? selectOptions(element) : [],
  };
}

function semanticYesNoCheckboxGroups(controls) {
  const candidates = new Map();
  const semanticGroups = new Map();

  for (const control of controls) {
    if (descriptorType(control) !== 'checkbox') continue;
    const name = normalize(control.getAttribute('name'));
    const container = labelledGroupContainer(control);
    if (!name || !container) continue;

    const byOwner = candidates.get(container) ?? new Map();
    const owner = control.form ?? control.ownerDocument;
    const byName = byOwner.get(owner) ?? new Map();
    const group = byName.get(name) ?? [];
    group.push(control);
    byName.set(name, group);
    byOwner.set(owner, byName);
    candidates.set(container, byOwner);
  }

  for (const byOwner of candidates.values()) {
    for (const byName of byOwner.values()) {
      for (const group of byName.values()) {
        if (group.length !== 2) continue;
        const labels = group.map((element) => radioOptionLabel(element).toLowerCase());
        if (new Set(labels).size !== 2 || !labels.includes('yes') || !labels.includes('no')) continue;
        for (const element of group) semanticGroups.set(element, group);
      }
    }
  }

  return semanticGroups;
}

export function scanForm(root = document) {
  const candidates = [...root.querySelectorAll('input, textarea, select, [role="combobox"], .select2-container, .AutocompleteSelectFieldUIWidget')]
    .filter((element) => !isIgnored(element))
    .filter((element) => descriptorType(element) !== 'file' || hasFileIdentity(element));
  // Keep the semantic combobox where available; older Select2 versions get
  // one manual widget descriptor. Never mark its hidden native backing field
  // or its internal editable search input as a second application answer.
  const customRoots = candidates.filter(element => descriptorType(element) === 'custom');
  const controls = candidates.filter(element => {
    if (element.matches('.select2-container, .AutocompleteSelectFieldUIWidget')
      && element.querySelector('[role="combobox"]')) return false;
    return !customRoots.some(parent => parent !== element && parent.contains(element)
      && !(parent.matches('.select2-container, .AutocompleteSelectFieldUIWidget')
        && parent.querySelector('[role="combobox"]')));
  });
  const radioGroups = new Map();

  for (const control of controls) {
    if (descriptorType(control) !== 'radio') continue;
    const name = normalize(control.getAttribute('name'));
    const owner = name ? control.form : control;
    const ownerGroups = radioGroups.get(owner) ?? new Map();
    const group = ownerGroups.get(name) ?? [];
    group.push(control);
    ownerGroups.set(name, group);
    radioGroups.set(owner, ownerGroups);
  }

  const visitedRadios = new Set();
  const semanticCheckboxGroups = semanticYesNoCheckboxGroups(controls);
  const visitedCheckboxChoices = new Set();
  const descriptors = [];

  for (const control of controls) {
    if (descriptorType(control) === 'radio') {
      if (visitedRadios.has(control)) continue;
      const name = normalize(control.getAttribute('name'));
      const owner = name ? control.form : control;
      const group = radioGroups.get(owner).get(name);
      group.forEach((radio) => visitedRadios.add(radio));
      descriptors.push(radioDescriptor(group));
      continue;
    }

    const checkboxChoiceGroup = semanticCheckboxGroups.get(control);
    if (checkboxChoiceGroup) {
      if (visitedCheckboxChoices.has(control)) continue;
      checkboxChoiceGroup.forEach((checkbox) => visitedCheckboxChoices.add(checkbox));
      descriptors.push(radioDescriptor(checkboxChoiceGroup));
      continue;
    }

    descriptors.push(controlDescriptor(control));
  }

  const sensitiveIds = new Set(controls.filter(isSensitiveControl)
    .map((control) => control.getAttribute(FIELD_ID_ATTRIBUTE)));
  return descriptors.map((descriptor) => (
    sensitiveIds.has(descriptor.field_id) || isSensitiveDescriptor(descriptor)
      ? { ...descriptor, sensitive: true }
      : descriptor
  ));
}

function isJobPosting(value) {
  const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']];
  return value && typeof value === 'object' && types.includes('JobPosting');
}

function findJobPosting(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const posting = findJobPosting(item);
      if (posting) return posting;
    }
    return null;
  }

  if (!value || typeof value !== 'object') return null;
  if (isJobPosting(value) && normalize(value.title)) return value;

  for (const child of Object.values(value)) {
    const posting = findJobPosting(child);
    if (posting) return posting;
  }

  return null;
}

function jsonLdPosting(root) {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const posting = findJobPosting(JSON.parse(script.textContent));
      if (posting) return posting;
    } catch {
      // Invalid page metadata is ignored in favor of conservative fallbacks.
    }
  }

  return null;
}

const JOB_DESCRIPTION_SELECTORS = [
  '[itemprop="description"]',
  '[data-automation-id="jobPostingDescription"]',
  '[data-testid*="job-description" i]',
  '#job-description',
  '.job-description',
  '[class*="jobDescription"]',
];

function cleanJobTextContainer(container) {
  if (!container) return '';
  const clone = container.cloneNode(true);
  clone.querySelectorAll(
    'script, style, noscript, template, form, input, textarea, select, button',
  ).forEach((element) => element.remove());
  const read = node => {
    if (node.nodeType === 3) return String(node.textContent).replace(/\s+/g, ' ');
    if (node.nodeType === 1 && node.tagName === 'BR') return '\n';
    const text = [...node.childNodes].map(read).join('');
    if (node.tagName === 'LI') return `• ${text.trim()}\n`;
    if (/^(P|DIV|H[1-6]|SECTION|ARTICLE|UL|OL)$/.test(node.tagName)) return `\n\n${text.trim()}\n\n`;
    return text;
  };
  return read(clone).split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_JOB_DESCRIPTION_CHARS);
}

function jobTextFromMarkup(root, value) {
  const container = root.createElement('template');
  container.innerHTML = String(value ?? '');
  return cleanJobTextContainer(container.content);
}

function jobDescription(root, posting) {
  const structured = jobTextFromMarkup(root, posting?.description);
  if (structured) return structured;

  for (const selector of JOB_DESCRIPTION_SELECTORS) {
    const text = cleanJobTextContainer(root.querySelector(selector));
    if (text) return text;
  }
  return '';
}

function jobLocations(root, posting) {
  const values = [];
  if (normalize(posting?.jobLocationType).toUpperCase() === 'TELECOMMUTE') values.push('Remote');
  const locations = Array.isArray(posting?.jobLocation) ? posting.jobLocation : [posting?.jobLocation];
  for (const location of locations) {
    if (!location) continue;
    const address = location.address;
    if (typeof address === 'string') values.push(normalize(address));
    else if (address && typeof address === 'object') {
      values.push([address.addressLocality, address.addressRegion,
        typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry,
      ].map(normalize).filter(Boolean).join(', '));
    } else values.push(normalize(typeof location === 'string' ? location : location.name));
  }
  if (!values.some(Boolean)) {
    for (const element of root.querySelectorAll('[itemprop="jobLocation"], [data-automation-id="locations"], [data-testid*="job-location" i], .job-location')) {
      if (element.closest('form') || isUnavailableControl(element)) continue;
      values.push(cleanJobTextContainer(element).replace(/\n+/g, ', '));
    }
  }
  return [...new Set(values.map(normalize).filter(Boolean))].slice(0, 12).map(value => value.slice(0, 200));
}

function jobFingerprint({ url, title, description }) {
  const value = `${url}\n${title}\n${description}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `job-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function hostFor(pageUrl) {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sanitizedPageUrl(pageUrl) {
  try {
    const url = new URL(String(pageUrl ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

export function scrapePageContext(root = document, pageUrl = location.href) {
  const posting = jsonLdPosting(root);
  const heading = root.querySelector('h1, [role="heading"][aria-level="1"]');
  const documentTitle = root.title ?? root.ownerDocument?.title;
  const organization = posting?.hiringOrganization;
  const url = sanitizedPageUrl(pageUrl);
  const company = normalize(organization?.name) || hostFor(url);
  const title = normalize(posting?.title)
    || normalize(heading?.textContent)
    || normalize(documentTitle);
  const description = jobDescription(root, posting);

  return {
    company,
    title,
    locations: jobLocations(root, posting),
    url,
    description,
    fingerprint: jobFingerprint({ url, title, description }),
  };
}
