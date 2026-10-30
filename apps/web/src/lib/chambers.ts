/**
 * Helpers for the "Chambers" design (styles/chambers.css).
 */

/** Which look a route gets: the landing page keeps its own design. */
export function uiFor(pathname: string): 'landing' | 'chambers' {
  return pathname === '/' ? 'landing' : 'chambers';
}

/**
 * On phones every `.tbl` is drawn as a stack of cards (see chambers.css), and
 * each cell shows its column name from `data-label`. Views don't set those
 * labels, so copy them from the table head here, for every table that appears.
 * Cells that already carry a `data-label` keep it.
 */
function labelTable(table: HTMLTableElement): void {
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return;
  const labels: string[] = [];
  for (const th of Array.from(head.cells)) {
    const text = (th.textContent ?? '').trim();
    for (let i = 0; i < th.colSpan; i++) labels.push(text);
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        // A cell spanning the whole row is a message ("No hearings yet").
        if (cell.colSpan >= labels.length && labels.length > 1) cell.dataset.span = 'all';
        else if (!cell.hasAttribute('data-label') && labels[col]) cell.setAttribute('data-label', labels[col]!);
        col += cell.colSpan;
      }
    }
  }
}

export function watchStackedTables(): () => void {
  let queued = false;
  const run = () => {
    queued = false;
    document.querySelectorAll<HTMLTableElement>('table.tbl').forEach(labelTable);
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(run);
  };
  run();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
