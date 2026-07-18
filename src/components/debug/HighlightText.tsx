import type { ReactNode } from 'react';

/** Plain text highlighter: React escapes content, no HTML injection. */
export default function HighlightText({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, index) => part.toLowerCase() === needle.toLowerCase()
    ? <mark className="lens-highlight" key={index}>{part}</mark>
    : part);
}
