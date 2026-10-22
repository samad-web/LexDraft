import { AdvocateDashboardView } from './AdvocateDashboardView';

interface DashboardViewProps {
  onNav: (view: string) => void;
}

/**
 * `/app/dashboard`. One advocate's-day dashboard for every plan; what differs
 * by plan/role (firm pulse, billing figures, Mine/Firm switch) is decided by
 * features inside AdvocateDashboardView. The firm-wide strategic view lives
 * at /app/firm (FirmDashboardView).
 */
export function DashboardView(_props: DashboardViewProps) {
  return <AdvocateDashboardView />;
}
