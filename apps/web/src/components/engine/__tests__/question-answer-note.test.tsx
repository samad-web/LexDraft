import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionAnswerNote } from '../QuestionAnswerNote';

describe('QuestionAnswerNote', () => {
  it('shows the answer, what to verify and the draft offer, announced to screen readers', () => {
    const html = renderToStaticMarkup(<QuestionAnswerNote answer={{ text: 'Yes.\n\nSection 17.', verify: ['Section 17 of the Registration Act, 1908'], draftOffer: 'Partition Deed' }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('<p style="margin:0 0 8px">Yes.</p><p style="margin:0 0 8px">Section 17.</p>');
    expect(html).toContain('bare Act before relying on it: Section 17 of the Registration Act, 1908.');
    expect(html).toContain('To draft a Partition Deed');
  });

  it('shows nothing without an answer, and no empty verify or offer lines', () => {
    expect(renderToStaticMarkup(<QuestionAnswerNote answer={null} />)).toBe('');
    const html = renderToStaticMarkup(<QuestionAnswerNote answer={{ text: 'No.', verify: [] }} />);
    expect(html).not.toContain('bare Act');
    expect(html).not.toContain('To draft');
  });
});
