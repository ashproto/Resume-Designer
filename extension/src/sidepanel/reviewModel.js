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
    const mapped = mappedById.get(fieldId);
    const human = humanById.get(fieldId);
    const needsHuman = Boolean(human || !mapped);
    const type = String(descriptor.type ?? 'text');
    const value = mapped ? String(mapped.value ?? '') : '';
    const manualFile = type === 'file' && value !== '__resume_pdf__';

    return {
      field_id: fieldId,
      label: String(descriptor.label ?? fieldId),
      type,
      options: descriptorOptions(descriptor.options),
      value,
      confidence: typeof mapped?.confidence === 'number' ? mapped.confidence : null,
      source: typeof mapped?.source === 'string' ? mapped.source : null,
      question: human?.question
        ? String(human.question)
        : needsHuman
          ? 'Please complete this field manually.'
          : null,
      needsHuman,
      lowConfidence: typeof mapped?.confidence === 'number' && mapped.confidence < 0.7,
      manualFile,
    };
  });
}

function warningFor(item) {
  return {
    field_id: item.field_id,
    label: item.label,
    reason: item.question || 'Please complete this field manually.',
  };
}

export function buildFillPayload(items = []) {
  const fields = [];
  const warnings = [];

  for (const item of items) {
    if (item.manualFile) {
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
