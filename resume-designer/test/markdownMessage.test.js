import { describe, it, expect } from 'vitest';
import { formatMessage } from '../src/markdownMessage.js';

describe('formatMessage (sanitized markdown)', () => {
  it('renders safe markdown', () => {
    const html = formatMessage('**bold** and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('strips inline event handlers', () => {
    const html = formatMessage('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('removes <script> tags', () => {
    const html = formatMessage('hi <script>alert(1)</script>');
    expect(html.toLowerCase()).not.toContain('<script');
  });

  it('neutralizes javascript: URLs', () => {
    const html = formatMessage('[click](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
  });

  it('returns empty string for falsy input', () => {
    expect(formatMessage('')).toBe('');
    expect(formatMessage(null)).toBe('');
  });
});
