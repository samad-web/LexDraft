import { describe, it, expect } from 'vitest';
import { buildDocumentHtml } from '../export-doc';

/**
 * Regression guard for the export formatting bug: the PDF/DOCX exporter must
 * carry the SAME alignment + text formatting the on-screen preview shows
 * (.court-prose in globals.css). Before the fix the export shipped a stripped
 * stylesheet — paragraphs fell back to left-aligned, headings lost their
 * centering, and indents/underlines drifted. These assertions pin the export
 * HTML to the preview's rules so it can't silently regress again.
 */
describe('buildDocumentHtml — export mirrors preview formatting', () => {
  const html = buildDocumentHtml({
    title: 'Legal Notice u/s 138 NI Act',
    bodyHtml:
      '<h1>In the Court of the Learned Judge</h1>' +
      '<p>This is a <strong>bold</strong> and <em>italic</em> and <u>underlined</u> clause.</p>' +
      '<ol><li>First averment.</li><li>Second averment.</li></ol>',
    dated: '2026-09-09',
    advocate: null, // suppress signature → no auth-store dependency in the test
    letterhead: null, // no letterhead → plain title block
  });

  it('justifies body paragraphs (not left-aligned)', () => {
    expect(html).toMatch(/\.doc-body p\s*\{[^}]*text-align:\s*justify/);
  });

  it('centers + uppercases top-level headings like the preview', () => {
    expect(html).toMatch(/\.doc-body h1[\s\S]*?text-align:\s*center/);
    expect(html).toMatch(/\.doc-body h1[\s\S]*?text-transform:\s*uppercase/);
  });

  it('indents ordered/unordered lists to match the preview', () => {
    expect(html).toMatch(/\.doc-body ol, \.doc-body ul\s*\{[^}]*padding-left:\s*36pt/);
  });

  it('renders bold / italic / underline styling rules', () => {
    expect(html).toMatch(/\.doc-body strong, \.doc-body b\s*\{[^}]*font-weight:\s*700/);
    expect(html).toMatch(/\.doc-body em, \.doc-body i\s*\{[^}]*font-style:\s*italic/);
    expect(html).toMatch(/\.doc-body u\s*\{[^}]*text-decoration:\s*underline/);
  });

  it('preserves the inline formatting tags from the body HTML verbatim', () => {
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>underlined</u>');
  });

  it('keeps body typography aligned with the preview (14pt / 1.5 line-height)', () => {
    expect(html).toMatch(/body\s*\{[^}]*font-size:\s*14pt/);
    expect(html).toMatch(/body\s*\{[^}]*line-height:\s*1\.5/);
  });
});
