import { Fragment, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { useCase } from '@/hooks/useCases';
import type { Case } from '@lexdraft/types';
import { NewHearingModal } from '@/components/NewHearingModal';
import { NewTaskModal } from '@/components/NewTaskModal';
import { NewDocumentModal } from '@/components/NewDocumentModal';

const STAGES: ReadonlyArray<string> = [
  'Filing', 'Summons', 'WS', 'Issues', 'Evidence', 'Arguments', 'Judgment', 'Appeal',
];

interface TimelineEntry {
  date: string;
  title: string;
  body: string;
  /** Border-left tone for the entry. */
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral';
}

interface PartyEntry {
  side: 'Plaintiff' | 'Defendant';
  name: string;
  role: string;
  addr: string;
  counsel: string;
}

const TIMELINE: ReadonlyArray<TimelineEntry> = [];

const PARTIES: ReadonlyArray<PartyEntry> = [];

interface TaskEntry {
  title: string;
  due: string;
  assignee: string;
  done?: boolean;
}

interface DocEntry {
  name: string;
  type: string;
  filed: string;
}

const TASKS: ReadonlyArray<TaskEntry> = [];

const RECENT_DOCS: ReadonlyArray<DocEntry> = [];

export function CaseDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useCase(id);
  const [docOpen, setDocOpen] = useState(false);
  const [hearingOpen, setHearingOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <BackButton onBack={() => navigate('/app/cases')} />
        <div className="card"><span className="muted">Loading matter…</span></div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <BackButton onBack={() => navigate('/app/cases')} />
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <div className="heading-sm" style={{ marginBottom: 6 }}>Couldn’t load matter</div>
          <p className="body-sm muted">
            {error instanceof Error ? error.message : 'The case could not be found.'}
          </p>
        </div>
      </div>
    );
  }

  const c: Case = data;
  const currentIdx = STAGES.indexOf(String(c.stage));

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <BackButton onBack={() => navigate('/app/cases')} />

      {/* HEADER */}
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <span className="badge badge-sage">{c.status.toUpperCase()}</span>
              <span className="badge badge-cobalt">{String(c.type).toUpperCase()}</span>
            </div>
            <h1 className="heading-xl" style={{ marginBottom: 8 }}>
              <em className="case-name">{c.title}</em>
            </h1>
            <div className="row" style={{ gap: 14, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 13 }}>
              <span>{c.court}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span className="mono tabular">CNR {c.cnr}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span>For: {c.client}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setDocOpen(true)}
            >
              <Icon name="upload" size={14} /> Upload
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setHearingOpen(true)}
            >
              <Icon name="plus" size={14} /> Hearing
            </button>
          </div>
        </div>

        {/* STAGE STEPPER */}
        <div style={{ marginTop: 24, overflowX: 'auto', paddingBottom: 4 }}>
          <div className="row" style={{ gap: 0, minWidth: 'min-content' }}>
            {STAGES.map((s, i) => {
              const done   = i < currentIdx;
              const active = i === currentIdx;
              return (
                <Fragment key={s}>
                  <div className="col" style={{ alignItems: 'center', gap: 6, minWidth: 80, flex: '0 0 auto' }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 'var(--radius-full)',
                        border: `2px solid ${active ? 'var(--text-primary)' : done ? 'var(--text-secondary)' : 'var(--border-default)'}`,
                        background: done ? 'var(--text-secondary)' : active ? 'var(--text-primary)' : 'var(--bg-surface)',
                        color: done ? 'var(--bg-base)' : active ? 'var(--bg-base)' : 'var(--text-tertiary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                      }}
                    >
                      {done ? '✓' : i + 1}
                    </div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 10,
                        letterSpacing: '0.16em',
                        color: active ? 'var(--text-primary)' : done ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                        fontWeight: active ? 600 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.toUpperCase()}
                    </span>
                  </div>
                  {i < STAGES.length - 1 && (
                    <div
                      style={{
                        flex: 1,
                        minWidth: 24,
                        height: 1,
                        background: i < currentIdx ? 'var(--text-secondary)' : 'var(--border-default)',
                        marginTop: 12,
                      }}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {/* BODY — two columns */}
      <div className="case-body" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24, alignItems: 'flex-start' }}>
        {/* LEFT */}
        <div className="col" style={{ gap: 24 }}>
          {/* Case meta */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Matter</div>
            <h2 className="heading-md" style={{ marginBottom: 12 }}>Overview</h2>
            <div className="grid-2" style={{ gap: 16 }}>
              <MetaItem label="CNR"        value={c.cnr}         mono />
              <MetaItem label="Court"      value={c.court} />
              <MetaItem label="Stage"      value={String(c.stage)} />
              <MetaItem label="Status"     value={c.status} />
              <MetaItem label="Client"     value={c.client} />
              <MetaItem label="Next date"  value={c.next}        mono />
            </div>
          </div>

          {/* Timeline */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Timeline</h2>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                {TIMELINE.length} EVENTS
              </span>
            </div>
            {TIMELINE.length === 0 ? (
              <p className="body-md muted">No events recorded for this matter yet.</p>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {TIMELINE.map((e, i) => (
                  <div
                    key={`${e.date}-${i}`}
                    className="card"
                    style={{ padding: 18, borderLeft: `3px solid ${toneToColor(e.tone)}` }}
                  >
                    <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
                      <div
                        className="mono tabular"
                        style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', minWidth: 92, paddingTop: 2 }}
                      >
                        {e.date}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div className="heading-sm" style={{ marginBottom: 4 }}>{e.title}</div>
                        <div className="body-sm muted">{e.body}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Parties */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Parties</h2>
            </div>
            {PARTIES.length === 0 ? (
              <p className="body-md muted">No parties on record. Add them when the case file is opened.</p>
            ) : (
              <div className="grid-2">
                {PARTIES.map((p) => (
                  <div key={p.name} className="card" style={{ padding: 20 }}>
                    <div className="eyebrow" style={{ marginBottom: 6 }}>{p.side}</div>
                    <div className="heading-md" style={{ marginBottom: 4 }}>{p.name}</div>
                    <div className="body-sm muted" style={{ marginBottom: 12 }}>{p.role}</div>
                    <div className="body-sm" style={{ marginBottom: 8 }}>{p.addr}</div>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
                      COUNSEL: {p.counsel}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="col" style={{ gap: 24 }}>
          {/* Next hearing */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Next hearing</div>
            {c.next ? (
              <div className="mono tabular" style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
                {c.next}
              </div>
            ) : (
              <p className="body-md muted" style={{ marginBottom: 16 }}>No date scheduled.</p>
            )}
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() =>
                  navigate('/app/draft', {
                    state: {
                      caseContext: {
                        id: c.id,
                        title: c.title,
                        cnr: c.cnr,
                        court: c.court,
                        client: c.client,
                        type: c.type,
                        stage: c.stage,
                      },
                    },
                  })
                }
              >
                Prepare brief
              </button>
            </div>
          </div>

          {/* Tasks */}
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="heading-md">Tasks</div>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                {TASKS.filter((t) => !t.done).length} OPEN
              </span>
            </div>
            {TASKS.length === 0 ? (
              <p className="body-sm muted">No tasks. Add the first below.</p>
            ) : (
              <div className="col" style={{ gap: 0 }}>
                {TASKS.map((t, i) => (
                  <div
                    key={t.title}
                    className="row"
                    style={{
                      padding: '12px 0',
                      borderBottom: i < TASKS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      gap: 12,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      aria-hidden="true"
                      style={{
                        width: 16, height: 16,
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${t.done ? 'var(--success)' : 'var(--border-default)'}`,
                        background: t.done ? 'var(--success-bg)' : 'transparent',
                        color: 'var(--success)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {t.done && <Icon name="check" size={12} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          color: t.done ? 'var(--text-tertiary)' : 'var(--text-primary)',
                          textDecoration: t.done ? 'line-through' : 'none',
                        }}
                      >
                        {t.title}
                      </div>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginTop: 2 }}>
                        DUE {t.due.toUpperCase()} · {t.assignee}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => setTaskOpen(true)}
            >
              <Icon name="plus" size={12} /> Add task
            </button>
          </div>

          {/* Recent documents */}
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="heading-md">Recent documents</div>
              <span className="spacer" />
              <a href="/app/documents" onClick={(e) => { e.preventDefault(); navigate('/app/documents'); }}>
                All
              </a>
            </div>
            {RECENT_DOCS.length === 0 ? (
              <p className="body-sm muted">No documents on file.</p>
            ) : (
              <div className="col" style={{ gap: 0 }}>
                {RECENT_DOCS.map((d, i) => (
                  <div
                    key={d.name}
                    className="row"
                    style={{
                      padding: '10px 0',
                      borderBottom: i < RECENT_DOCS.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      gap: 12,
                    }}
                  >
                    <Icon name="file" size={14} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{d.name}</div>
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
                        {d.type.toUpperCase()}
                      </div>
                    </div>
                    <div className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{d.filed}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .case-body { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <NewDocumentModal open={docOpen} onClose={() => setDocOpen(false)} defaultCase={c.title} />
      <NewHearingModal
        open={hearingOpen}
        onClose={() => setHearingOpen(false)}
        defaultCase={c.title}
        defaultCourt={c.court}
        defaultDate={c.next || undefined}
      />
      <NewTaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        defaultCase={c.title}
      />
    </div>
  );
}

/* ---------- Inline helpers ---------- */

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={onBack}
      style={{ alignSelf: 'flex-start' }}
    >
      <Icon name="chevron" size={14} style={{ transform: 'scaleX(-1)' }} /> Cases
    </button>
  );
}

function MetaItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className={mono ? 'mono tabular' : ''} style={{ fontSize: 14, color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

function toneToColor(tone: TimelineEntry['tone']): string {
  switch (tone) {
    case 'info':    return 'var(--info)';
    case 'success': return 'var(--success)';
    case 'warning': return 'var(--warning)';
    case 'danger':  return 'var(--danger)';
    case 'neutral':
    default:        return 'var(--border-default)';
  }
}
