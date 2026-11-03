import { afterEach, describe, expect, it, vi } from 'vitest';
import { judgmentsService, orTsQuery, rrfMerge, trimExcerpt } from '../judgments.service';

// No DB, no network: the DB client is mocked per test (vi.mock is hoisted
// above the imports).
const { dbMock } = vi.hoisted(() => ({ dbMock: vi.fn() }));
vi.mock('../../db/client', () => ({ db: () => dbMock() }));
// The search switch is pinned on here, whatever the local .env says.
const { envState } = vi.hoisted(() => ({ envState: { judgmentsSearch: true } }));
vi.mock('../../env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../env')>();
  return { ...actual, env: new Proxy(actual.env, { get: (t, k) => (k === 'judgmentsSearch' ? envState.judgmentsSearch : Reflect.get(t, k)) }) };
});
vi.mock('../embeddings.service', () => ({
  embeddingsService: { embed: () => Promise.reject(new Error('offline in tests')) },
}));

/** A fake postgres-js tag: the corpus "exists" probe answers `exists`, every
 *  other query does `rest()`. */
function fakeSql(exists: boolean, rest: () => Promise<unknown>) {
  const tag = (strings: TemplateStringsArray) =>
    strings.join('?').includes('exists(') ? Promise.resolve([{ exists }]) : rest();
  const sql = Object.assign(tag, {
    unsafe: (s: string) => s,
    // Search queries run in a transaction (for statement_timeout); same tag inside.
    begin: (fn: (tx: typeof tag) => Promise<unknown>) => fn(sql),
  });
  return sql;
}

afterEach(() => {
  dbMock.mockReset();
  vi.useRealTimers();
});

describe('rrfMerge', () => {
  it('ranks items found by both lists above items found by one', () => {
    const merged = rrfMerge([['a', 'b', 'c'], ['c', 'd', 'a']]);
    expect(merged.map((m) => m.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(merged[0]!.score).toBeCloseTo(1 / 61 + 1 / 63);
  });

  it('works with one empty list (FTS-only) and ignores duplicates within a list', () => {
    expect(rrfMerge([['x', 'y', 'x'], []]).map((m) => m.id)).toEqual(['x', 'y']);
    expect(rrfMerge([[], []])).toEqual([]);
  });
});

describe('orTsQuery', () => {
  it('keeps only [a-z0-9] terms, drops noise and short words, dedupes', () => {
    expect(orTsQuery("The petitioner's bail: parity with co-accused; bail & custody!")).toBe('bail | parity | accused | custody');
  });

  it('cannot inject tsquery syntax and caps the term count', () => {
    expect(orTsQuery("a' & !b | (c:*)")).toBe('');
    expect(orTsQuery(Array.from({ length: 50 }, (_, i) => `term${i}`).join(' '), 5).split(' | ')).toHaveLength(5);
  });
});

describe('trimExcerpt', () => {
  it('keeps short text and cuts long text at a sentence end', () => {
    expect(trimExcerpt('Short.')).toBe('Short.');
    const long = `${'First sentence is long enough. '.repeat(15)}Tail without end`;
    const out = trimExcerpt(long, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('.')).toBe(true);
  });
});

describe('forGrounds fails soft', () => {
  const grounds = ['The detenu was granted statutory bail, not bail on merits.'];

  it('JUDGMENTS_SEARCH=false never touches the database', async () => {
    envState.judgmentsSearch = false;
    try {
      dbMock.mockImplementation(() => { throw new Error('db must not be called'); });
      expect(await judgmentsService.configured()).toBe(false);
    } finally {
      envState.judgmentsSearch = true;
      dbMock.mockReset();
    }
  });

  it('returns [] with no database', async () => {
    dbMock.mockReturnValue(null);
    expect(await judgmentsService.forGrounds(grounds)).toEqual([]);
  });

  it('returns [] when the table is missing', async () => {
    const missing = () => Promise.reject(new Error('relation "judgments" does not exist'));
    dbMock.mockReturnValue(Object.assign(missing, { unsafe: (s: string) => s }));
    expect(await judgmentsService.configured()).toBe(false);
    expect(await judgmentsService.forGrounds(grounds)).toEqual([]);
  });

  it('returns [] when the search query errors', async () => {
    dbMock.mockReturnValue(fakeSql(true, () => Promise.reject(new Error('connection reset'))));
    expect(await judgmentsService.forGrounds(grounds)).toEqual([]);
  });

  it('returns [] when retrieval exceeds its time budget (12s)', async () => {
    vi.useFakeTimers();
    dbMock.mockReturnValue(fakeSql(true, () => new Promise(() => undefined))); // never settles
    const p = judgmentsService.forGrounds(grounds);
    await vi.advanceTimersByTimeAsync(12_100);
    expect(await p).toEqual([]);
  });

  it('maps hits to authorities, one per judgment, when the DB answers', async () => {
    const row = {
      paragraph_id: 'p1', judgment_id: 'j1', para_no: 5, text: 'Bail on statutory grounds is not bail on merits.',
      case_title: 'M.KALA v. THE SECRETARY TO THE GOVERNMENT', court: 'Madras High Court', court_code: 'MHC',
      case_number: 'HCP/83/2024', neutral_citation: null, reported_citations: [], decision_date: '2024-04-18',
      source_url: 'https://www.mhc.tn.gov.in/judis', pdf_url: 'https://example.test/x.pdf',
    };
    dbMock.mockReturnValue(fakeSql(true, () => Promise.resolve([row, { ...row, paragraph_id: 'p2', para_no: 6 }])));
    expect(await judgmentsService.forGrounds(grounds, { k: 3 })).toEqual([{
      id: 'j1',
      cite: 'M.KALA v. THE SECRETARY TO THE GOVERNMENT, (HCP/83/2024, Madras High Court, 18.04.2024)',
      court: 'Madras High Court',
      decisionDate: '2024-04-18',
      paraNo: 5,
      excerpt: 'Bail on statutory grounds is not bail on merits.',
      url: 'https://example.test/x.pdf',
    }]);
  });

  it('returns [] for empty / trivial grounds without touching the DB', async () => {
    expect(await judgmentsService.forGrounds(['', 'short'])).toEqual([]);
    expect(dbMock).not.toHaveBeenCalled();
  });
});
