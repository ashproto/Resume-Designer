import { isSensitiveDescriptor, SENSITIVE_MANUAL_MESSAGE } from '../sensitivity.js';

function descriptorOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => ({
    value: String(option?.value ?? ''),
    label: String(option?.label ?? option?.value ?? ''),
  }));
}

export function buildReviewItems(descriptors = [], mapping = {}) {
  const mappedById = new Map(
    (mapping.fields ?? []).map((field) => [field.field_id, field]),
  );
  const humanById = new Map(
    (mapping.needs_human ?? []).map((item) => [item.field_id, item]),
  );

  return descriptors.map((descriptor) => {
    const fieldId = descriptor.field_id;
    const manualSensitive = isSensitiveDescriptor(descriptor);
    const mapped = manualSensitive ? null : mappedById.get(fieldId);
    const human = manualSensitive ? { question: SENSITIVE_MANUAL_MESSAGE } : humanById.get(fieldId);
    const needsHuman = Boolean(human || !mapped);
    const type = String(descriptor.type ?? 'text');
    const value = mapped ? String(mapped.value ?? '') : '';
    const manualFile = type === 'file' && value !== '__resume_pdf__';
    const manualCustom = type === 'custom';

    return {
      field_id: fieldId,
      label: String(descriptor.label ?? fieldId),
      type,
      options: manualSensitive ? [] : descriptorOptions(descriptor.options),
      value,
      confidence: typeof mapped?.confidence === 'number' ? mapped.confidence : null,
      source: typeof mapped?.source === 'string' ? mapped.source : null,
      aiDraft: mapped?.source === 'draft',
      question: human?.question
        ? String(human.question)
        : needsHuman
          ? 'Please complete this field manually.'
          : null,
      needsHuman,
      lowConfidence: typeof mapped?.confidence === 'number' && mapped.confidence < 0.7,
      manualFile,
      manualCustom,
      manualSensitive,
      sensitive: manualSensitive,
    };
  });
}

function warningFor(item) {
  return {
    field_id: item.field_id,
    label: item.label,
    reason: isSensitiveDescriptor(item)
      ? SENSITIVE_MANUAL_MESSAGE
      : item.manualCustom
      ? 'This custom control must be completed manually.'
      : item.question || 'Please complete this field manually.',
  };
}

export function buildFillPayload(items = []) {
  const fields = [];
  const warnings = [];

  for (const item of items) {
    if (item.manualFile || item.manualCustom || isSensitiveDescriptor(item)) {
      warnings.push(warningFor(item));
      continue;
    }

    if (item.needsHuman && !String(item.value ?? '').trim()) {
      warnings.push(warningFor(item));
      continue;
    }

    fields.push({
      field_id: item.field_id,
      value: String(item.value ?? ''),
    });
  }

  return { fields, warnings };
}
