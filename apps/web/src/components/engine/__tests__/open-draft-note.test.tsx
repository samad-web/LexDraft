import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OpenDraftNote } from '../OpenDraftNote';

describe('OpenDraftNote', () => {
  it('labels an open draft, for screen readers too', () => {
    const html = renderToStaticMarkup(<OpenDraftNote state={{ draftedBy: 'open' }} />);
    expect(html).toContain('role="note"');
    expect(html).toContain('without a verified DifAi format');
  });

  it.each(['engine', 'ai', undefined] as const)('shows nothing for draftedBy=%s', (draftedBy) => {
    expect(renderToStaticMarkup(<OpenDraftNote state={{ draftedBy }} />)).toBe('');
  });
});
