import type { ReactNode } from 'react';

/**
 * Tiny, safe renderer for the editable legal pages. It understands only "## Heading", "- list item"
 * and paragraphs, and renders everything as escaped React text, so page content can never inject markup.
 */
export function Prose({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`}>{list.map((t, i) => <li key={i}>{t}</li>)}</ul>);
    list = [];
  };
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); blocks.push(<h2 key={`h${blocks.length}`}>{line.slice(3)}</h2>); }
    else if (line.startsWith('- ')) list.push(line.slice(2));
    else { flush(); blocks.push(<p key={`p${blocks.length}`}>{line}</p>); }
  }
  flush();
  return <div className="prose-lite">{blocks}</div>;
}
