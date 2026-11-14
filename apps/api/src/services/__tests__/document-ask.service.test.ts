import { beforeEach, describe, expect, it, vi } from 'vitest';

const replies: string[] = [];
const calls: Array<{ system: string; user: string; maxTokens: number }> = [];
vi.mock('../../lib/llm-drafting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llm-drafting')>();
  return {
    ...actual,
    resolveProvider: () => 'anthropic' as const,
    providerModel: () => 'test-model',
    complete: vi.fn(async (_p: string, system: string, user: string, maxTokens: number) => {
      calls.push({ system, user, maxTokens });
      const text = replies.shift();
      if (text === undefined) throw new Error('reply queue empty');
      return { text, tokensIn: 10, tokensOut: 10, cacheRead: 0, cacheWrite: 0 };
    }),
  };
});
const assertCanGenerate = vi.fn(async () => ({}));
vi.mock('../ai-quota.service', () => ({
  aiQuotaService: { assertCanGenerate: (...a: unknown[]) => assertCanGenerate(...(a as [])) },
  AiQuotaExceededError: class extends Error {},
}));
vi.mock('../ai-usage.service', () => ({ aiUsageService: { recordAsync: vi.fn() } }));

// Local OCR / PDF readers, scripted — no tesseract, no real PDF.
const ocrImage = vi.fn();
vi.mock('../../lib/image-ocr', () => ({ ocrImage: (b: Buffer) => ocrImage(b) }));
const ocrPdf = vi.fn();
vi.mock('../../lib/pdf-ocr', () => ({ ocrPdf: (b: Buffer) => ocrPdf(b) }));
let pdfPages: Array<Array<{ str: string; y: number }>> = [];
vi.mock('pdf-parse', () => ({
  default: async (_buf: Buffer, opts: { pagerender: (p: unknown) => Promise<string> }) => {
    const texts: string[] = [];
    for (const items of pdfPages) {
      texts.push(await opts.pagerender({
        getTextContent: async () => ({ items: items.map((i) => ({ str: i.str, transform: [0, 0, 0, 0, 0, i.y] })) }),
      }));
    }
    return { text: texts.join('\n\n') };
  },
}));

import {
  documentAskService, DocumentReadError, NOT_IN_DOCUMENT, readDocument, segmentParagraphs, verifyQuotes,
  type DocPage,
} from '../document-ask.service';

const b64 = (s: string) => Buffer.from(s).toString('base64');
const CTX = { firmId: 'firm-1', userId: 'user-1' };

const FIR: DocPage[] = [
  { page: 1, text: 'FIRST INFORMATION REPORT\n\nFIR No. 112/2026, P.S. Avadi.\n\nDate of occurrence: 14.02.2026 at about 22:30 hours.' },
  { page: 2, text: 'The complainant states that the accused took Rs. 40,000 from his shop counter.\n\nSections: 303(2) BNS.' },
];

beforeEach(() => {
  replies.length = 0;
  calls.length = 0;
  assertCanGenerate.mockClear();
  ocrImage.mockReset();
  ocrPdf.mockReset();
  pdfPages = [];
});

describe('segmentParagraphs', () => {
  it('splits on blank lines when the text has them', () => {
    expect(segmentParagraphs('One line\ncontinued.\n\nTwo.')).toEqual(['One line continued.', 'Two.']);
  });

  it('splits a PDF text layer at numbered points and short sentence-ending lines', () => {
    const page = [
      '1. The petitioner was arrested on 16.09.2024 by the respondent police and has been',
      'in custody since then without any progress in the investigation.',
      '2. The charge sheet has been filed and no further custody is needed for the case.',
      'Short closing line.',
      'Another paragraph that starts after a short line ending a sentence and is long',
    ].join('\n');
    const paras = segmentParagraphs(page);
    expect(paras).toHaveLength(3);
    expect(paras[0]).toMatch(/^1\. The petitioner .* investigation\.$/);
    // A full-width line ending a sentence does not end the paragraph…
    expect(paras[1]).toMatch(/^2\. .*Short closing line\.$/);
    // …a short one does.
    expect(paras[2]).toMatch(/^Another paragraph/);
  });
});

describe('verifyQuotes', () => {
  it('keeps real quotes, re-points a mis-cited one, drops invented ones', () => {
    const q = verifyQuotes([
      { page: 1, para: 3, text: 'Date of occurrence: 14.02.2026' },
      { page: 1, para: 1, text: 'took Rs. 40,000 from his shop counter' }, // really p.2 para 1
      { page: 2, para: 2, text: 'Sections: 379 IPC' }, // not in the document
      { page: 1, para: 3, text: '“date of occurrence:  14.02.2026”' }, // duplicate, quote marks + case
    ], FIR);
    expect(q).toEqual([
      { page: 1, paragraph: 3, text: 'Date of occurrence: 14.02.2026' },
      { page: 2, paragraph: 1, text: 'took Rs. 40,000 from his shop counter' },
    ]);
  });
});

describe('readDocument', () => {
  it('reads a PDF page by page from the text layer', async () => {
    pdfPages = [
      [{ str: 'ORDER', y: 700 }, { str: 'The petition is allowed.', y: 680 }],
      [{ str: 'Costs ', y: 700 }, { str: 'of Rs. 5,000.', y: 700 }],
    ];
    const r = await readDocument({ fileName: 'order.pdf', mime: 'application/pdf', dataBase64: b64('%PDF') });
    expect(r).toMatchObject({ kind: 'pdf', ocr: false, truncated: false });
    expect(r.pages).toEqual([
      { page: 1, text: 'ORDER\nThe petition is allowed.' },
      { page: 2, text: 'Costs of Rs. 5,000.' },
    ]);
    expect(ocrPdf).not.toHaveBeenCalled();
  });

  it('OCRs a scanned PDF and keeps the page numbers', async () => {
    pdfPages = [[{ str: ' ', y: 1 }], [{ str: '', y: 1 }]];
    ocrPdf.mockResolvedValue({ ok: true, text: 'x', pages: 2, pageTexts: ['Page one text here', ''] });
    const r = await readDocument({ fileName: 'scan.pdf', mime: 'application/pdf', dataBase64: b64('%PDF') });
    expect(r.ocr).toBe(true);
    expect(r.pages).toEqual([{ page: 1, text: 'Page one text here' }]);
  });

  it('OCRs an image as page 1', async () => {
    ocrImage.mockResolvedValue({ ok: true, text: 'FIR No. 12/2026' });
    const r = await readDocument({ fileName: 'fir.jpg', mime: 'image/jpeg', dataBase64: b64('img') });
    expect(r).toMatchObject({ kind: 'image', ocr: true, pages: [{ page: 1, text: 'FIR No. 12/2026' }] });
  });

  it('reads plain text without pages', async () => {
    const r = await readDocument({ fileName: 'note.txt', mime: 'text/plain', dataBase64: b64('Hello\n\n\n\nWorld') });
    expect(r.pages).toEqual([{ page: null, text: 'Hello\n\nWorld' }]);
  });

  it('refuses unsupported and unreadable files', async () => {
    await expect(readDocument({ fileName: 'a.zip', mime: 'application/zip', dataBase64: b64('PK') }))
      .rejects.toBeInstanceOf(DocumentReadError);
    ocrImage.mockResolvedValue({ ok: false, error: 'no text' });
    await expect(readDocument({ fileName: 'blank.png', mime: 'image/png', dataBase64: b64('x') }))
      .rejects.toThrow(/scan/);
  });

  it('caps very long documents and says so', async () => {
    const big = 'a'.repeat(70_000);
    pdfPages = [[{ str: big, y: 1 }], [{ str: big, y: 1 }]];
    const r = await readDocument({ fileName: 'big.pdf', mime: 'application/pdf', dataBase64: b64('%PDF') });
    expect(r.truncated).toBe(true);
    expect(r.chars).toBe(120_000);
  });
});

describe('documentAskService.ask', () => {
  it('sends labelled paragraphs and returns a verified answer', async () => {
    replies.push(JSON.stringify({
      found: true,
      answer: 'The occurrence was on 14.02.2026 at about 22:30 hours (p.1 para 3).',
      quotes: [{ page: 1, para: 3, text: 'Date of occurrence: 14.02.2026 at about 22:30 hours.' }],
    }));
    const r = await documentAskService.ask({ fileName: 'fir.pdf', pages: FIR, question: 'When did it happen?' }, CTX);
    // Credits are charged by the route now (ai-credits.test.ts), not the service.
    expect(assertCanGenerate).not.toHaveBeenCalled();
    // The document rides in the prompt-cached system block, not the user turn.
    expect(calls[0]!.system).toContain('[p.1 para 3] Date of occurrence');
    expect(calls[0]!.system).toContain('[p.2 para 2] Sections: 303(2) BNS.');
    expect(calls[0]!.user).not.toContain('Date of occurrence');
    expect(r.found).toBe(true);
    expect(r.quotes).toEqual([{ page: 1, paragraph: 3, text: 'Date of occurrence: 14.02.2026 at about 22:30 hours.' }]);
  });

  it('says the document does not answer when every quote is invented', async () => {
    replies.push(JSON.stringify({
      found: true,
      answer: 'The accused was arrested on 15.02.2026.',
      quotes: [{ page: 1, para: 2, text: 'arrested on 15.02.2026' }],
    }));
    const r = await documentAskService.ask({ fileName: 'fir.pdf', pages: FIR, question: 'When was he arrested?' }, CTX);
    expect(r.found).toBe(false);
    expect(r.answer).toContain(NOT_IN_DOCUMENT);
    expect(r.quotes).toEqual([]);
  });

  it('passes a not-found reply through without quotes', async () => {
    replies.push(JSON.stringify({ found: false, answer: 'The FIR does not name any witness.', quotes: [{ page: 1, para: 1, text: 'FIRST INFORMATION REPORT' }] }));
    const r = await documentAskService.ask({
      fileName: 'fir.pdf', pages: FIR, question: 'Who are the witnesses?',
      history: [{ question: 'FIR number?', answer: '112/2026 (p.1 para 2).' }],
    }, CTX);
    expect(calls[0]!.user).toContain('Q: FIR number?');
    expect(r).toEqual({ found: false, answer: 'The FIR does not name any witness.', quotes: [] });
  });
});
