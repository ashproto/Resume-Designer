import { FIELD_ID_ATTRIBUTE } from './scan.js';

const TEXT_INPUT_TYPES = new Set([
  'date',
  'datetime-local',
  'email',
  'month',
  'number',
  'password',
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

function ownerView(element) {
  const view = element.ownerDocument?.defaultView;
  if (!view) throw new Error('The field is not attached to a fillable page');
  return view;
}

function nativeSetter(element, prototypeName, property, value) {
  const prototype = ownerView(element)[prototypeName]?.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, property)?.set;

  if (!setter) throw new Error(`The field does not support ${property} updates`);
  setter.call(element, value);
}

function dispatchFillEvents(element) {
  const EventConstructor = ownerView(element).Event;

  element.dispatchEvent(new EventConstructor('input', { bubbles: true }));
  element.dispatchEvent(new EventConstructor('change', { bubbles: true }));
}

function markedElements(root, fieldId) {
  return [...root.querySelectorAll(`[${FIELD_ID_ATTRIBUTE}]`)]
    .filter((element) => element.getAttribute(FIELD_ID_ATTRIBUTE) === fieldId);
}

function inputType(element) {
  return normalize(element.getAttribute('type') || 'text').toLowerCase();
}

function optionLabel(option) {
  return normalize(option.label || option.textContent);
}

function radioLabel(element) {
  const associated = [...(element.labels ?? [])]
    .map((label) => normalize(label.textContent))
    .filter(Boolean)
    .join(' ');
  if (associated) return associated;

  const ownLabel = normalize(element.getAttribute('aria-label'));
  if (ownLabel) return ownLabel;

  return normalize(element.getAttribute('aria-labelledby'))
    .split(' ')
    .map((id) => normalize(element.ownerDocument.getElementById(id)?.textContent))
    .filter(Boolean)
    .join(' ');
}

function matchingOption(options, value, labelFor) {
  const requested = String(value ?? '');
  const exact = options.find((option) => String(option.value) === requested);
  if (exact) return exact;

  const requestedLabel = normalize(requested).toLowerCase();
  return options.find((option) => labelFor(option).toLowerCase() === requestedLabel);
}

function isButtonBackedCheckbox(element) {
  if (element.getAttribute('tabindex') !== '-1' || radioLabel(element)) return false;

  let container = element.parentElement;
  while (container && !['FORM', 'BODY', 'HTML'].includes(container.tagName)) {
    const buttonLabels = [...container.querySelectorAll('button')]
      .map((button) => normalize(button.textContent).toLowerCase());

    if (buttonLabels.includes('yes') && buttonLabels.includes('no')) return true;
    container = container.parentElement;
  }

  return false;
}

function fillText(element, value) {
  const prototypeName = element.tagName === 'TEXTAREA'
    ? 'HTMLTextAreaElement'
    : 'HTMLInputElement';
  const requestedValue = String(value ?? '');
  const previousValue = element.value;

  nativeSetter(element, prototypeName, 'value', requestedValue);

  if (element.value !== requestedValue) {
    nativeSetter(element, prototypeName, 'value', previousValue);
    throw new Error('The browser rejected this value; complete the field manually');
  }

  dispatchFillEvents(element);
}

function fillSelect(element, value) {
  const option = matchingOption([...element.options], value, optionLabel);
  if (!option) throw new Error(`No select option matches "${String(value ?? '')}"`);

  nativeSetter(element, 'HTMLSelectElement', 'value', option.value);
  dispatchFillEvents(element);
}

function fillRadio(elements, value) {
  const radio = matchingOption(elements, value, radioLabel);
  if (!radio) throw new Error(`No radio option matches "${String(value ?? '')}"`);

  nativeSetter(radio, 'HTMLInputElement', 'checked', true);
  dispatchFillEvents(radio);
}

function fillCheckbox(element, value) {
  if (isButtonBackedCheckbox(element)) {
    throw new Error('This custom Yes/No control must be filled manually');
  }

  if (typeof value !== 'string' || !['true', 'false'].includes(value.toLowerCase())) {
    throw new Error('Checkbox values must be the string "true" or "false"');
  }

  nativeSetter(element, 'HTMLInputElement', 'checked', value.toLowerCase() === 'true');
  dispatchFillEvents(element);
}

function pdfFile(element, pdf) {
  if (!pdf?.filename || !pdf?.pdfBase64) {
    throw new Error('A résumé PDF payload is required for this file field');
  }

  const view = ownerView(element);
  const decoded = view.atob(pdf.pdfBase64);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new view.File([bytes], pdf.filename, { type: 'application/pdf' });
}

function fillFile(element, pdf, dataTransferFactory) {
  const view = ownerView(element);
  const file = pdfFile(element, pdf);
  const dataTransfer = dataTransferFactory
    ? dataTransferFactory()
    : new view.DataTransfer();

  dataTransfer.items.add(file);
  element.files = dataTransfer.files;
  dispatchFillEvents(element);
}

function fillReviewedField(elements, value, options) {
  const first = elements[0];
  const role = normalize(first.getAttribute('role')).toLowerCase();

  if (role === 'combobox') throw new Error('This custom combobox is unsupported and must be filled manually');
  if (first.tagName === 'TEXTAREA') return fillText(first, value);
  if (first.tagName === 'SELECT') return fillSelect(first, value);

  if (first.tagName !== 'INPUT') {
    throw new Error('This custom control is unsupported and must be filled manually');
  }

  const type = inputType(first);
  if (TEXT_INPUT_TYPES.has(type)) return fillText(first, value);
  if (type === 'radio') return fillRadio(elements, value);
  if (type === 'checkbox') return fillCheckbox(first, value);
  if (type === 'file') return fillFile(first, options.pdf, options.dataTransferFactory);

  throw new Error(`Input type "${type}" is unsupported and must be filled manually`);
}

function failureReason(error) {
  return error instanceof Error ? error.message : String(error);
}

export function fillForm(
  reviewedFields,
  { root = document, pdf, dataTransferFactory } = {},
) {
  const filled = [];
  const unfilled = [];

  for (const reviewedField of reviewedFields ?? []) {
    const fieldId = reviewedField?.field_id;

    try {
      const elements = markedElements(root, fieldId);
      if (elements.length === 0) throw new Error('The reviewed field was not found on this page');

      fillReviewedField(elements, reviewedField?.value, { pdf, dataTransferFactory });
      filled.push(fieldId);
    } catch (error) {
      unfilled.push({ field_id: fieldId, reason: failureReason(error) });
    }
  }

  return { filled, unfilled };
}
