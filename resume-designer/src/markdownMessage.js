// Renders chat message markdown to sanitized HTML. Isolated from chatPanel.js
// so it can be unit-tested without the panel's heavy import graph. marked does
// NOT sanitize, so its output is always piped through DOMPurify before it can
// reach the DOM — chat content is untrusted (AI model output, or text pasted
// from an external source: a prompt-injected/malicious model could emit
// `<img onerror=...>` / `<script>` / `javascript:` URLs).
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { escapeHtml } from './htmlEscape.js';

marked.setOptions({
  breaks: true,      // Convert line breaks to <br>
  gfm: true,         // Enable GitHub Flavored Markdown
  headerIds: false,  // Don't add IDs to headers
  mangle: false,     // Don't mangle email addresses
});

export function formatMessage(content) {
  if (!content) return '';
  try {
    return DOMPurify.sanitize(marked.parse(content));
  } catch (e) {
    console.error('Markdown parsing error:', e);
    // Fallback to basic escaping
    return escapeHtml(content).replace(/\n/g, '<br>');
  }
}
