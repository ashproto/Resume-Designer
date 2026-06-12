import { useRef, useEffect } from 'react';
import { formatMessage } from '../../markdownMessage.js';

/**
 * Renders chat-message markdown. `formatMessage()` parses markdown and pipes it
 * through DOMPurify, so its output is already sanitized HTML. We turn that string
 * into real nodes with DOMParser (which never executes scripts) and adopt them
 * via replaceChildren — deliberately NOT React's raw-HTML escape hatch, matching
 * how App.jsx injects the shell and keeping us off the raw-innerHTML path.
 */
export function Markdown({ content, className = 'chat-markdown' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = formatMessage(content);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    el.replaceChildren(...doc.body.childNodes);
  }, [content]);

  return <div ref={ref} className={className} />;
}
