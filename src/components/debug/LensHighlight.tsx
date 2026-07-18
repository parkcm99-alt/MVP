import type { ReactNode } from 'react';

export default function LensHighlight({ text, query }: { text: string; query: string }): ReactNode {
  const term = query.trim();
  if (!term) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, index) => part.toLowerCase() === term.toLowerCase()
    ? <mark className="lens-highlight" key={index}>{part}</mark>
    : part);
}
