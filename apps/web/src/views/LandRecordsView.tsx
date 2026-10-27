import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '@lexdraft/ui';
import { PageHeader } from '@/components/PageHeader';
import { PillNav } from '@/components/PillNav';
import { LandServiceScreen } from '@/components/land-records/LandServiceScreen';
import { LandApplicationsPanel } from '@/components/land-records/LandApplicationsPanel';
import { LAND_MENU } from '@/components/land-records/LandUi';
import { prepareLandRecords, useAddLandApplication, type LandService } from '@/hooks/useLandRecords';

// =============================================================================
// LandRecordsView - Tamil Nadu Land Records eServices (eservices.tn.gov.in)
// inside DifAI. Home lists the site's services in its own order and
// wording; each opens the site's page for it, driven live (see
// components/land-records). "My Applications" follows patta transfer /
// F-Line applications (status checked on demand, one captcha).
//
// URL: ?service=<id> opens a service; ?tab=applications; ?app=<id> prefills
// Application Status (from "Check status").
// =============================================================================

const SERVICE_IDS = new Set<string>(LAND_MENU.map((m) => m.id));

// Home groups the site's services by the kind of land / task, so an advocate
// finds "urban" or "application" services without reading every tile. The
// site's verbatim menu label stays on each tile's tooltip.
const SERVICE_GROUPS: ReadonlyArray<{ title: string; note: string; ids: LandService[] }> = [
  { title: 'Rural / Natham land', note: 'By district, taluk, village and survey number - including the poramboke check', ids: ['patta', 'a-register', 'fmb', 'verify-patta', 'poramboke'] },
  { title: 'Urban land', note: 'Town survey: town, ward and block', ids: ['tslr-extract', 'tslr-sketch'] },
  { title: 'Applications', note: 'Patta transfer and F-Line, by Application Id', ids: ['app-status', 'order-copy', 'fline'] },
];

const TILE: Record<LandService, { title: string; icon: IconName }> = {
  'patta':        { title: 'Patta / Chitta / FMB', icon: 'documents' },
  'a-register':   { title: 'A-Register extract', icon: 'diary' },
  'verify-patta': { title: 'Verify Patta / Chitta', icon: 'review' },
  'poramboke':    { title: 'Government or private land', icon: 'building' },
  'fmb':          { title: 'FMB sketch', icon: 'map' },
  'order-copy':   { title: 'Patta order copy', icon: 'file' },
  'tslr-extract': { title: 'TSLR extract', icon: 'clauses' },
  'tslr-sketch':  { title: 'TSLR sketch', icon: 'map' },
  'app-status':   { title: 'Application status', icon: 'limitation' },
  'fline':        { title: 'F-Line sketch / statement', icon: 'analytics' },
};

export function LandRecordsView() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('service');
  const service = raw && SERVICE_IDS.has(raw) ? (raw as LandService) : null;
  const tab = params.get('tab') === 'applications' ? 'applications' : 'services';
  const prefillApp = params.get('app') ?? undefined;
  const follow = useAddLandApplication();
  // Have the site's home page ready before a service is picked (opens faster).
  useEffect(() => { prepareLandRecords(); }, []);

  const go = (next: Record<string, string>): void => setParams(next);
  const home = (): void => go({});

  return (
    <div className="col" style={{ gap: 16, maxWidth: 1240 }}>
      <PageHeader
        title="Land Records"
        description="Patta, A-Register, FMB and TSLR records from Tamil Nadu eServices, fetched live and filed into your matters and title reports."
        meta={`eservices.tn.gov.in · ${LAND_MENU.length} services`}
      />

      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <PillNav
          items={[
            { id: 'services', label: 'Services' },
            { id: 'applications', label: 'My applications' },
          ]}
          value={tab}
          onChange={(t) => (t === 'applications' ? go({ tab: 'applications' }) : home())}
          ariaLabel="Land Records menu"
        />
      </div>

      {tab === 'applications' ? (
        <LandApplicationsPanel onCheck={(a) => go({ service: 'app-status', app: a.applicationId })} />
      ) : service ? (
        <LandServiceScreen
          key={`${service}:${prefillApp ?? ''}`}
          service={service}
          onHome={home}
          initialApplicationId={prefillApp}
          onFollow={(applicationId) => follow.mutate(
            { applicationId, kind: service === 'fline' ? 'fline' : 'patta_transfer' },
            { onSuccess: () => go({ tab: 'applications' }) },
          )}
        />
      ) : (
        <div className="col" style={{ gap: 22 }}>
          <ol className="lr-how-strip" aria-label="How it works">
            <li><b>Pick a service</b><span>District, taluk, village or Application Id</span></li>
            <li><b>Verify</b><span>OTP to your mobile, or a small captcha sum</span></li>
            <li><b>Read the record</b><span>Fetched live from the Revenue Department</span></li>
            <li><b>Save it</b><span>To a matter or a title report</span></li>
          </ol>
          <section aria-label="Land Records services" className="col" style={{ gap: 22, minWidth: 0 }}>
            {SERVICE_GROUPS.map((g) => (
              <div key={g.title} className="col" style={{ gap: 10 }}>
                <div className="lr-group-head">
                  <span className="eyebrow">{g.title}</span>
                  <span className="lr-group-note">{g.note}</span>
                </div>
                <div className="lr-grid">
                  {g.ids.map((id) => {
                    const m = LAND_MENU.find((x) => x.id === id);
                    if (!m) return null;
                    const tile = TILE[id];
                    return (
                      <button key={id} type="button" className="lr-tile" title={m.label} onClick={() => go({ service: id })}>
                        <span className="lr-tile-icon"><Icon name={tile.icon} size={17} /></span>
                        <span className="lr-tile-title">{tile.title}</span>
                        <span className="lr-tile-blurb">{m.blurb}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        </div>
      )}
      {follow.isError ? <p className="body-sm" role="alert" style={{ fontWeight: 600 }}>Could not follow the application. Use My Applications to add it.</p> : null}
    </div>
  );
}
