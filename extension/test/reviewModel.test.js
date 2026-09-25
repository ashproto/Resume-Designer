import { describe, expect, it } from 'vitest';

import {
  buildFillPayload,
  buildReviewItems,
} from '../src/sidepanel/reviewModel.js';

function descriptor(fieldId, overrides = {}) {
  return {
    field_id: fieldId,
    label: fieldId,
    type: 'text',
    options: [],
    required: false,
    ...overrides,
  };
}

function mapped(fieldId, value, confidence = 0.8, source = 'resume') {
  return {
    field_id: fieldId,
    value,
    confidence,
    source,
  };
}

describe('buildReviewItems', () => {
  it('preserves descriptor order and normalizes mapped and needs-human records', () => {
    const descriptors = [
      descriptor('name', { label: 'Full name' }),
      descriptor('location', {
        label: 'Location',
        type: 'select',
        options: [{ value: 'remote_us', label: 'Remote - US' }],
      }),
      descriptor('notice', { label: 'Notice period?' }),
    ];
    const mapping = {
      fields: [
        mapped('location', 'remote_us', 0.7, 'profile'),
        mapped('name', 'Jane Applicant', 0.69),
      ],
      needs_human: [{ field_id: 'notice', question: 'What is your notice period?' }],
    };

    const items = buildReviewItems(descriptors, mapping);

    expect(items.map(({ field_id: fieldId }) => fieldId)).toEqual([
      'name',
      'location',
      'notice',
    ]);
    expect(items[0]).toMatchObject({
      label: 'Full name',
      type: 'text',
      value: 'Jane Applicant',
      confidence: 0.69,
      source: 'resume',
      question: null,
      needsHuman: false,
      lowConfidence: true,
      manualFile: false,
    });
    expect(items[1]).toMatchObject({
      options: [{ value: 'remote_us', label: 'Remote - US' }],
      value: 'remote_us',
      confidence: 0.7,
      lowConfidence: false,
    });
    expect(items[2]).toMatchObject({
      value: '',
      confidence: null,
      source: null,
      question: 'What is your notice period?',
      needsHuman: true,
      lowConfidence: false,
      manualFile: false,
    });
  });

  it('marks only non-resume file mappings as manual and preserves string checkboxes', () => {
    const descriptors = [
      descriptor('consent', { type: 'checkbox', label: 'Available immediately?' }),
      descriptor('resume', { type: 'file', label: 'Upload resume' }),
      descriptor('cover', { type: 'file', label: 'Cover letter' }),
    ];
    const mapping = {
      fields: [
        mapped('consent', 'false', 1, 'learned'),
        mapped('resume', '__resume_pdf__', 1),
      ],
      needs_human: [{ field_id: 'cover', question: 'Attach cover letter manually.' }],
    };

    const items = buildReviewItems(descriptors, mapping);

    expect(items[0]).toMatchObject({ value: 'false', type: 'checkbox' });
    expect(items[1]).toMatchObject({
      value: '__resume_pdf__',
      needsHuman: false,
      manualFile: false,
    });
    expect(items[2]).toMatchObject({
      value: '',
      needsHuman: true,
      manualFile: true,
    });
  });

  it('still represents a descriptor omitted by malformed mapping as manual review', () => {
    const [item] = buildReviewItems([descriptor('missing')], {
      fields: [],
      needs_human: [],
    });

    expect(item).toMatchObject({
      field_id: 'missing',
      value: '',
      needsHuman: true,
      question: 'Please complete this field manually.',
    });
  });

  it('marks mapped and needs-human custom controls as manual while preserving internal values', () => {
    const items = buildReviewItems([
      descriptor('country', { label: 'Country', type: 'custom' }),
      descriptor('location', { label: 'Location', type: 'custom' }),
    ], {
      fields: [mapped('country', 'USA', 1, 'learned')],
      needs_human: [{
        field_id: 'location',
        question: 'What location should be listed?',
      }],
    });

    expect(items[0]).toMatchObject({
      field_id: 'country',
      type: 'custom',
      value: 'USA',
      needsHuman: false,
      manualCustom: true,
    });
    expect(items[1]).toMatchObject({
      field_id: 'location',
      type: 'custom',
      value: '',
      needsHuman: true,
      manualCustom: true,
    });

    items[1] = { ...items[1], value: 'Canada' };
    expect(buildFillPayload(items)).toEqual({
      fields: [],
      warnings: [{
        field_id: 'country',
        label: 'Country',
        reason: 'This custom control must be completed manually.',
      }, {
        field_id: 'location',
        label: 'Location',
        reason: 'This custom control must be completed manually.',
      }],
    });
  });
});

describe('AI draft review', () => {
  it('preserves draft attribution and fills the reviewed narrative', () => {
    const items = buildReviewItems([
      descriptor('motivation', { type: 'textarea', label: 'What interests you about this role?' }),
    ], { fields: [mapped('motivation', 'A grounded draft.', 0.8, 'draft')] });
    expect(items[0]).toMatchObject({ aiDraft: true, source: 'draft', needsHuman: false });
    items[0].value = 'My reviewed answer.';
    expect(buildFillPayload(items)).toEqual({ fields: [{ field_id: 'motivation', value: 'My reviewed answer.' }], warnings: [] });
  });
});

describe('buildFillPayload', () => {
  it('keeps reviewed values in order and reports empty/manual needs-human items locally', () => {
    const items = buildReviewItems([
      descriptor('name', { label: 'Full name' }),
      descriptor('consent', { type: 'checkbox', label: 'Available immediately?' }),
      descriptor('notice', { label: 'Notice period' }),
      descriptor('cover', { type: 'file', label: 'Cover letter' }),
      descriptor('resume', { type: 'file', label: 'Resume' }),
    ], {
      fields: [
        mapped('name', 'Jane'),
        mapped('consent', 'true'),
        mapped('resume', '__resume_pdf__', 1),
      ],
      needs_human: [
        { field_id: 'notice', question: 'What is your notice period?' },
        { field_id: 'cover', question: 'Attach cover letter manually.' },
      ],
    });

    const result = buildFillPayload(items);

    expect(result.fields).toEqual([
      { field_id: 'name', value: 'Jane' },
      { field_id: 'consent', value: 'true' },
      { field_id: 'resume', value: '__resume_pdf__' },
    ]);
    expect(result.warnings).toEqual([
      {
        field_id: 'notice',
        label: 'Notice period',
        reason: 'What is your notice period?',
      },
      {
        field_id: 'cover',
        label: 'Cover letter',
        reason: 'Attach cover letter manually.',
      },
    ]);
  });

  it('includes a user-entered needs-human answer but never a manual file', () => {
    const items = buildReviewItems([
      descriptor('notice', { label: 'Notice period' }),
      descriptor('portfolio', { type: 'file', label: 'Portfolio' }),
    ], {
      fields: [],
      needs_human: [
        { field_id: 'notice', question: 'Notice?' },
        { field_id: 'portfolio', question: 'Attach manually.' },
      ],
    });
    items[0] = { ...items[0], value: 'Two weeks' };
    items[1] = { ...items[1], value: 'must-not-send.pdf' };

    expect(buildFillPayload(items)).toEqual({
      fields: [{ field_id: 'notice', value: 'Two weeks' }],
      warnings: [{
        field_id: 'portfolio',
        label: 'Portfolio',
        reason: 'Attach manually.',
      }],
    });
  });
});
