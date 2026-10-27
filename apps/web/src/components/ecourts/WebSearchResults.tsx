import type { EcourtsWebSearchResult } from '@/hooks/useEcourts';

/** Plain-text result rows from an eCourts website search. Rows that carry a
 *  CNR open in DifAI's own case view (hearings, orders, business text). */
export function WebSearchResults({
  result,
  onOpenCnr,
}: {
  result: EcourtsWebSearchResult;
  onOpenCnr?: (cnr: string) => void;
}) {
  return (
    <div className="card">
      {result.rows.length === 0 ? (
        <p className="body-sm muted">{result.text || 'eCourts returned no records for this search.'}</p>
      ) : (
        <>
          <div className="heading-sm" style={{ marginBottom: 10 }}>
            {result.rows.length} {result.rows.length === 1 ? 'record' : 'records'}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              {result.headers.length > 0 ? (
                <thead><tr>{result.headers.map((h, i) => <th key={i}>{h}</th>)}{onOpenCnr ? <th /> : null}</tr></thead>
              ) : null}
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}>
                    {r.cells.map((c, j) => <td key={j}>{c}</td>)}
                    {onOpenCnr ? (
                      <td>
                        {r.cino ? (
                          <button type="button" className="btn btn-sm" onClick={() => onOpenCnr(r.cino!)}>View case</button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
