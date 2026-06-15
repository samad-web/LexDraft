/**
 * Build the HTML body for a "session transcript + review" PDF export.
 *
 * Pipes into the existing `exportPdf` in lib/export-doc.ts which handles
 * pagination, page header/footer, signature block, and the AI-disclaimer
 * footer. We just produce the body HTML — escaped, structured, and styled
 * for the print iframe `export-doc.ts` opens.
 *
 * Why a separate file: Mock Arguments has a quirky shape compared to the
 * drafting flow that export-doc.ts was built for (turn-by-turn transcript,
 * a rubric grid, per-turn ratings). Keeping the layout here so future
 * iterations don't have to wade through the general-purpose exporter to
 * tweak the rendering.
 */

import { exportPdf } from './export-doc';
import type { MaCitation, MaReview, MaSessionWithTurns, MaTurn } from '@/hooks/useMockArguments';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function renderMatterSummary(session: MaSessionWithTurns): string {
  const s = session.matterSummary;
  const rows: string[] = [];
  if (s.court) rows.push(`<tr><th>Court</th><td>${esc(s.court)}</td></tr>`);
  if (s.parties.petitioner) rows.push(`<tr><th>Petitioner</th><td>${esc(s.parties.petitioner)}</td></tr>`);
  if (s.parties.respondent) rows.push(`<tr><th>Respondent</th><td>${esc(s.parties.respondent)}</td></tr>`);
  rows.push(`<tr><th>Your role</th><td>${esc(session.role)}</td></tr>`);
  rows.push(`<tr><th>Bench persona</th><td>${esc(session.judgePersona)}</td></tr>`);
  const list = (label: string, items: string[]): string =>
    items.length === 0 ? '' :
      `<tr><th>${esc(label)}</th><td><ul style="margin:0;padding-left:18px;">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></td></tr>`;
  rows.push(list('Facts', s.facts));
  rows.push(list('Issues', s.issues));
  rows.push(list('Applicable statutes', s.applicableStatutes));
  rows.push(list('Prior judgments', s.priorJudgments));
  return `
    <h2>Matter summary</h2>
    <table>
      <tbody>${rows.join('')}</tbody>
    </table>`;
}

function renderCitations(c: MaCitation[]): string {
  if (c.length === 0) return '';
  const items = c.map((it) => {
    const head = it.citation ?? `${it.actTitle ?? 'Act'} § ${it.sectionNumber ?? '?'}`;
    return `<li><strong>${esc(head)}</strong>${it.sectionHeading ? ` — ${esc(it.sectionHeading)}` : ''}</li>`;
  }).join('');
  return `<div style="font-size:10pt;color:#444;margin-top:6px;">Sources:<ul style="margin:4px 0 0 18px;padding:0;">${items}</ul></div>`;
}

function renderRating(turn: MaTurn): string {
  if (!turn.rating) return '';
  const r = turn.rating;
  const cell = (label: string, v: number): string =>
    `<span style="display:inline-block;padding:2px 6px;margin-right:6px;border:1px solid #ccc;border-radius:4px;font-size:10pt;">${esc(label)} ${v.toFixed(1)}</span>`;
  return `<div style="margin-top:8px;color:#444;">
    ${cell('Legal', r.legalSoundness)}${cell('Citations', r.citationUse)}${cell('Structure', r.structure)}${cell('Persuasive', r.persuasiveness)}${cell('Responsive', r.responsiveness)}
    ${r.comment ? `<div style="margin-top:4px;font-style:italic;font-size:10pt;">"${esc(r.comment)}"</div>` : ''}
  </div>`;
}

function renderTranscript(turns: MaTurn[]): string {
  if (turns.length === 0) {
    return '<h2>Transcript</h2><p style="color:#666;">No turns were recorded.</p>';
  }
  const items = turns.map((t) => {
    const who = t.speaker === 'user' ? 'You' : 'Opposing counsel';
    const body = esc(t.transcript).replace(/\n/g, '<br>');
    const cit = t.citations ? renderCitations(t.citations) : '';
    return `<div style="margin-bottom:18px;page-break-inside:avoid;">
      <div style="font-size:10pt;color:#777;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">Turn ${t.turnNumber} · ${esc(who)}</div>
      <div style="font-size:11pt;line-height:1.5;">${body}</div>
      ${cit}
      ${renderRating(t)}
    </div>`;
  }).join('');
  return `<h2>Transcript</h2>${items}`;
}

function renderReview(review: MaReview): string {
  const rubric = review.rubric;
  const cell = (label: string, v: number): string =>
    `<td style="text-align:center;"><div style="font-size:14pt;font-weight:600;">${v.toFixed(1)}<span style="font-size:10pt;color:#888;"> / 5</span></div><div style="font-size:10pt;color:#666;">${esc(label)}</div></td>`;

  const missed = review.missedArguments.length === 0 ? '' :
    `<h3>Missed arguments</h3><ul>${review.missedArguments.map((m) => `<li><strong>${esc(m.point)}</strong>${(m.statute || m.judgment) ? `<div style="font-size:10pt;color:#666;">${esc(m.statute ?? '')} ${m.judgment ? `· ${esc(m.judgment)}` : ''}</div>` : ''}${m.why ? `<div style="font-size:10pt;">${esc(m.why)}</div>` : ''}</li>`).join('')}</ul>`;

  const study = review.studyList.length === 0 ? '' :
    `<h3>Suggested study list</h3><ul>${review.studyList.map((s) => `<li><strong>${esc(s.title)}</strong>${s.citation ? `<div style="font-size:10pt;color:#666;">${esc(s.citation)}</div>` : ''}${s.why ? `<div style="font-size:10pt;">${esc(s.why)}</div>` : ''}</li>`).join('')}</ul>`;

  return `
    <h2>Review</h2>
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
      <strong>Overall</strong>
      <span style="font-size:14pt;font-weight:600;">${Math.round(rubric.overall)} / 100</span>
    </div>
    <table style="margin-bottom:12px;"><tbody><tr>
      ${cell('Legal soundness', rubric.legalSoundness)}
      ${cell('Citation use',    rubric.citationUse)}
      ${cell('Structure',       rubric.structure)}
      ${cell('Persuasiveness',  rubric.persuasiveness)}
      ${cell('Responsiveness',  rubric.responsiveness)}
    </tr></tbody></table>
    ${review.qualitativeSummary ? `<p>${esc(review.qualitativeSummary)}</p>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
      <div>
        <h3>Strengths</h3>
        ${review.strengths.length === 0 ? '<p style="color:#666;">None recorded.</p>' : `<ul>${review.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`}
      </div>
      <div>
        <h3>Weaknesses</h3>
        ${review.weaknesses.length === 0 ? '<p style="color:#666;">None recorded.</p>' : `<ul>${review.weaknesses.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`}
      </div>
    </div>
    ${missed}
    ${study}`;
}

export async function exportMockArgumentSessionPdf(
  session: MaSessionWithTurns,
): Promise<void> {
  const title = session.matterSummary.title || 'Mock argument session';
  const dated = new Date(session.startedAt).toISOString().slice(0, 10);
  const bodyHtml = `
    ${renderMatterSummary(session)}
    ${session.review ? renderReview(session.review) : ''}
    ${renderTranscript(session.turns)}`;
  await exportPdf({
    title: `${title} — Mock argument session`,
    bodyHtml,
    dated,
  });
}
