import {
  FIELD_ID_ATTRIBUTE,
  isButtonBackedYesNoCheckbox,
  isSensitiveControl,
  isUnavailableControl,
  scanForm,
} from './scan.js';
import { isSensitiveDescriptor, SENSITIVE_MANUAL_MESSAGE } from '../sensitivity.js';

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

function fillText(element, value) {
  const prototypeName = element.tagName === 'TEXTAREA'
    ? 'HTMLTextAreaElement'
    : 'HTMLInputElement';
  const requestedValue = String(value ?? '');
  const previousValue = element.value;
  if (element.maxLength >= 0 && requestedValue.length > element.maxLength) {
    throw new Error(`This answer exceeds the field’s ${element.maxLength}-character limit; shorten it before filling`);
  }

  nativeSetter(element, prototypeName, 'value', requestedValue);

  if (element.value !== requestedValue) {
    nativeSetter(element, prototypeName, 'value', previousValue);
    throw new Error('The browser rejected this value; complete the field manually');
  }

  dispatchFillEvents(element);
}

function fillSelect(element, value) {
  const option = matchingOption([...element.options], value, optionLabel);
  if (option?.disabled || option?.closest('optgroup[disabled]')) throw new Error('This option is disabled; choose another answer');
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
  if (isButtonBackedYesNoCheckbox(element)) {
    throw new Error('This custom Yes/No control must be filled manually');
  }

  if (typeof value !== 'string' || !['true', 'false'].includes(value.toLowerCase())) {
    throw new Error('Checkbox values must be the string "true" or "false"');
  }

  nativeSetter(element, 'HTMLInputElement', 'checked', value.toLowerCase() === 'true');
  dispatchFillEvents(element);
}

function fillCheckboxChoiceGroup(elements, value) {
  const selected = matchingOption(elements, value, radioLabel);
  if (!selected) throw new Error(`No checkbox option matches "${String(value ?? '')}"`);

  const checkedPeers = elements.filter((element) => element !== selected && element.checked);
  const changes = selected.checked ? checkedPeers : [...checkedPeers, selected];

  for (const element of changes) {
    nativeSetter(element, 'HTMLInputElement', 'checked', element === selected);
    dispatchFillEvents(element);
  }
}

function pdfFile(element, pdf) {
  if (!pdf?.filename || !pdf?.pdfBase64) {
    throw new Error('A resume PDF payload is required for this file field');
  }

  const view = ownerView(element);
  const decoded = view.atob(pdf.pdfBase64);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new view.File([bytes], pdf.filename, { type: 'application/pdf' });
}

function fillFile(element, pdf, dataTransferFactory) {
  const view = ownerView(element);
  const accepted = String(element.accept ?? '').toLowerCase().split(',').map((type) => type.trim()).filter(Boolean);
  if (accepted.length && !accepted.some((type) => ['.pdf', 'application/pdf', 'application/*', '*/*'].includes(type))) {
    throw new Error('This upload does not accept PDF files; attach the requested format manually');
  }
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
  if (type === 'checkbox' && elements.length > 1) return fillCheckboxChoiceGroup(elements, value);
  if (type === 'checkbox') return fillCheckbox(first, value);
  if (type === 'file') return fillFile(first, options.pdf, options.dataTransferFactory);

  throw new Error(`Input type "${type}" is unsupported and must be filled manually`);
}

function failureReason(error) {
  return error instanceof Error ? error.message : String(error);
}

export function fillForm(
  reviewedFields,
  { root = document, pdf, dataTransferFactory, expectedDescriptors } = {},
) {
  const filled = [];
  const unfilled = [];
  const expected = Array.isArray(expectedDescriptors)
    ? new Map(expectedDescriptors.map((descriptor) => [descriptor.field_id, descriptor]))
    : null;
  const descriptorSignature = (descriptor) => JSON.stringify({
    label: descriptor.label, type: descriptor.type, options: descriptor.options,
    required: descriptor.required, inputType: descriptor.inputType,
    maxLength: descriptor.maxLength, accept: descriptor.accept, sensitive: Boolean(descriptor.sensitive),
  });

  for (const reviewedField of reviewedFields ?? []) {
    const fieldId = reviewedField?.field_id;

    try {
      const elements = markedElements(root, fieldId);
      if (elements.length === 0) throw new Error('The reviewed field was not found on this page');
      if (elements.some(isUnavailableControl)) throw new Error('This field is hidden, disabled, or read-only; prepare a new review');
      if (expected) {
        const previous = expected.get(fieldId);
        // A previous input/change handler may have changed the next field.
        const matches = scanForm(root).filter((descriptor) => descriptor.field_id === fieldId);
        if (!previous || matches.length !== 1 || descriptorSignature(previous) !== descriptorSignature(matches[0])) {
          throw new Error('This field changed since the review was prepared; prepare a new review');
        }
        if (elements.length > 1 && previous.type !== 'radio') {
          throw new Error('This field is ambiguous on the page; prepare a new review');
        }
      }
      if (elements.some(isSensitiveControl) || isSensitiveDescriptor({
        options: elements.map((element) => ({ label: radioLabel(element), value: element.value })),
      })) throw new Error(SENSITIVE_MANUAL_MESSAGE);

      fillReviewedField(elements, reviewedField?.value, { pdf, dataTransferFactory });
      filled.push(fieldId);
    } catch (error) {
      unfilled.push({ field_id: fieldId, reason: failureReason(error) });
    }
  }

  return { filled, unfilled };
}
