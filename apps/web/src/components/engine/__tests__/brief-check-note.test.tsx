import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BriefCheckNote } from '../BriefCheckNote';

const base = { docLabel: 'Sale Deed', title: 'Sale Deed', missing: [] as string[], question: false };

describe('BriefCheckNote', () => {
  it('lists the missing facts for the named document, announced to screen readers', () => {
    const html = renderToStaticMarkup(<BriefCheckNote check={{ ...base, missing: ['Survey number', 'Sale price'] }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('For a Sale Deed, add these if you have them:');
    expect(html).toContain('<li>Survey number</li><li>Sale price</li>');
  });

  it('says when nothing is missing, and when the text is a question', () => {
    expect(renderToStaticMarkup(<BriefCheckNote check={base} />)).toContain('Nothing important looks missing for a Sale Deed');
    expect(renderToStaticMarkup(<BriefCheckNote check={{ ...base, question: true }} />)).toContain('reads as a question');
  });

  it('shows nothing before a check', () => {
    expect(renderToStaticMarkup(<BriefCheckNote check={null} />)).toBe('');
  });
});
