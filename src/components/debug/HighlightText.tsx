import type { ReactNode } from 'react';

/** React text nodes (not innerHTML) keep matching highlights safe. */
export default function HighlightText({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.trim().slice(0, 80);
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, index) => part.toLowerCase() === needle.toLowerCase()
    ? <mark className="lens-highlight" key={`${index}-${part}`}>{part}</mark>
    : <span key={`${index}-${part}`}>{part}</span>);
}
