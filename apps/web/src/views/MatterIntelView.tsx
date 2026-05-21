import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import type { Case } from '@lexdraft/types';
import { useCase, useCases } from '@/hooks/useCases';
import { MatterIntelPanel } from '@/components/matter-intel/MatterIntelPanel';
import {
  useCreateQuickStudy,
  useQuickStudies,
  type QuickStudy,
} from '@/hooks/useMatterIntel';
import { useUIStore } from '@/store/ui';

/**
 * Matter Intelligence view. Two modes driven by the URL:
 *
 *   /app/matter-intel            → matter / quick-study picker
 *   /app/matter-intel/:caseId    → the panel for the chosen matter
 *
 * The panel itself is the same component used inside CaseDetailView's
 * Intelligence tab — this view is the deep-link / sidebar entry point.
 *
 * Quick studies are sandbox matters (`cases.kind = 'sandbox'`) created
 * on the fly so the user can upload a file and chat against it without
 * first registering a real matter.
 */
export function MatterIntelView() {
  const { caseId } = useParams<{ caseId?: string }>();
  if (!caseId) return <MatterPicker />;
  return <MatterIntelForCase caseId={caseId} />;
}

// ---------------------------------------------------------------------------
// Picker — shown when the user lands on /app/matter-intel without a matter.
// ---------------------------------------------------------------------------

function MatterPicker() {
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const [q, setQ] = useState('');
  const casesQ        = useCases();
  const quickStudiesQ = useQuickStudies();
  const createQuick   = useCreateQuickStudy();

  const matters: Case[] = casesQ.data ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return matters;
    return matters.filter((m) =>
      m.title.toLowerCase().includes(needle)
      || (m.cnr ?? '').toLowerCase().includes(needle)
      || (m.client ?? '').toLowerCase().includes(needle)
      || (m.court ?? '').toLowerCase().includes(needle),
    );
  }, [matters, q]);

  const startQuickStudy = async () => {
    try {
      const sandbox = await createQuick.mutateAsync({});
      navigate(`/app/matter-intel/${sandbox.id}`);
    } catch (err) {
      showToast({ type: 'vermillion', text: err instanceof Error ? err.message : 'Could not start quick study' });
    }
  };

  const quickStudies = quickStudiesQ.data ?? [];

  return (
    <div className="col stack-5">
      <div>
        <div className="eyebrow">Matter Intelligence</div>
        <h1 className="heading-xl" style={{ marginTop: 4, marginBottom: 8 }}>
          Pick a matter — or start a quick study
        </h1>
        <p className="body-md muted" style={{ maxWidth: 720 }}>
          Matter Intelligence ingests documents, generates a synthesised brief,
          and answers cited questions. Use it on a real matter, or start a quick
          study to upload a one-off file and chat about it without registering
          anything in your case list.
        </p>
      </div>

      {/* Quick-study CTA */}
      <div className="card matter-intel-quickstudy-cta" style={{ padding: 20 }}>
        <div className="row" style={{ gap: 16, alignItems: 'center' }}>
          <div className="matter-intel-quickstudy-icon" aria-hidden>
            <Icon name="upload" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="heading-sm" style={{ marginBottom: 4 }}>
              Just want to ask questions about a PDF?
            </div>
            <p className="body-sm muted" style={{ margin: 0 }}>
              Start a quick study — a private sandbox where you can drop a file,
              get a summary, and chat with cited answers. Won&apos;t appear in your
              Cases or Clients lists.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void startQuickStudy()}
            disabled={createQuick.isPending}
          >
            {createQuick.isPending ? 'Starting…' : 'Start a quick study'}
          </button>
        </div>
      </div>

      {/* Recent quick studies */}
      {quickStudies.length > 0 && (
        <div className="col" style={{ gap: 12 }}>
          <div className="eyebrow">Your recent quick studies</div>
          <div className="grid-auto-lg">
            {quickStudies.map((s) => (
              <QuickStudyCard
                key={s.id}
                study={s}
                onOpen={() => navigate(`/app/matter-intel/${s.id}`)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Divider before the matters list */}
      <div className="row" style={{ alignItems: 'center', gap: 12, marginTop: 4 }}>
        <div className="eyebrow">Or pick a matter</div>
        <span style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <div className="row" style={{ flex: 1, gap: 8, alignItems: 'center', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', padding: '8px 12px', background: 'var(--bg-surface)' }}>
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search by title, CNR, client, court…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ flex: 1, background: 'transparent', border: 0, outline: 0, fontSize: 14 }}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/app/cases')}
        >
          Manage matters
        </button>
      </div>

      {casesQ.isLoading && (
        <div className="grid-auto-lg">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card" style={{ padding: 16 }}>
              <Skeleton width="60%" height={14} />
              <div style={{ marginTop: 10 }}><Skeleton width="80%" height={12} /></div>
              <div style={{ marginTop: 8 }}><Skeleton width="40%" height={12} /></div>
            </div>
          ))}
        </div>
      )}

      {casesQ.isError && (
        <ErrorState
          variant="inline"
          title="Couldn't load matters"
          description="Check your connection and try again."
        />
      )}

      {!casesQ.isLoading && !casesQ.isError && matters.length === 0 && (
        <EmptyState
          icon="cases"
          title="No matters yet"
          description="You don't have any registered matters yet. Use the quick-study button above to upload a file immediately, or head to Cases to create your first matter."
          action={
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/app/cases')}>
              Go to Cases
            </button>
          }
        />
      )}

      {!casesQ.isLoading && matters.length > 0 && filtered.length === 0 && (
        <EmptyState
          variant="inline"
          title={`No matters match "${q}"`}
          description="Try a different search term."
        />
      )}

      {filtered.length > 0 && (
        <div className="grid-auto-lg">
          {filtered.map((m) => (
            <MatterCard
              key={m.id}
              matter={m}
              onOpen={() => navigate(`/app/matter-intel/${m.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatterCard({ matter, onOpen }: { matter: Case; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="card matter-intel-picker-card"
      onClick={onOpen}
      style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {matter.status && (
          <span className="badge badge-sage">{String(matter.status).toUpperCase()}</span>
        )}
        {matter.type && (
          <span className="badge badge-cobalt">{String(matter.type).toUpperCase()}</span>
        )}
      </div>
      <div>
        <div className="heading-sm" style={{ marginBottom: 4 }}>
          <em className="case-name">{matter.title}</em>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: 12 }}>
          {matter.court && <span>{matter.court}</span>}
          {matter.cnr && (
            <>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span className="mono">{matter.cnr}</span>
            </>
          )}
          {matter.client && (
            <>
              <span style={{ color: 'var(--text-tertiary)' }}>·</span>
              <span>{matter.client}</span>
            </>
          )}
        </div>
      </div>
      <span className="row" style={{ gap: 6, color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
        Open Intelligence <Icon name="arrow" size={12} />
      </span>
    </button>
  );
}

function QuickStudyCard({ study, onOpen }: { study: QuickStudy; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="card matter-intel-picker-card"
      onClick={onOpen}
      style={{ textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="badge badge-cream">QUICK STUDY</span>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          {study.documentCount} doc{study.documentCount === 1 ? '' : 's'}
        </span>
      </div>
      <div>
        <div className="heading-sm" style={{ marginBottom: 4 }}>
          {study.title}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          Started {new Date(study.createdAt).toLocaleString()}
        </div>
      </div>
      <span className="row" style={{ gap: 6, color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>
        Open study <Icon name="arrow" size={12} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Per-matter panel host — shown at /app/matter-intel/:caseId.
// ---------------------------------------------------------------------------

function MatterIntelForCase({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  const caseQ = useCase(caseId);
  const quickStudiesQ = useQuickStudies();

  // Detect whether the case being viewed is a quick-study sandbox so we can
  // tweak the header chrome (no "Open matter" link, "QUICK STUDY" label).
  // We piggy-back on the quick-studies list rather than adding `kind` to
  // the Case payload — keeps the API surface narrow.
  const isQuickStudy = useMemo(
    () => Boolean(quickStudiesQ.data?.some((s) => s.id === caseId)),
    [quickStudiesQ.data, caseId],
  );

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/app/matter-intel')}
          aria-label="Back to picker"
        >
          <Icon name="chevron" size={14} /> All matters
        </button>
        {caseQ.data && !isQuickStudy && (
          <>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigate(`/app/cases/${caseId}`)}
            >
              Open matter
            </button>
          </>
        )}
        {isQuickStudy && (
          <>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span className="badge badge-cream">QUICK STUDY</span>
          </>
        )}
        <span className="spacer" />
        {caseQ.data && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {caseQ.data.title}
          </div>
        )}
      </div>

      <MatterIntelPanel caseId={caseId} matterTitle={caseQ.data?.title} />
    </div>
  );
}
