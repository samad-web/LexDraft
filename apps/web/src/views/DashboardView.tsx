import { useAuthStore } from '@/store/auth';
import { SoloDashboardView } from './SoloDashboardView';
import { PracticeDashboardView } from './PracticeDashboardView';
import { FirmDashboardView } from './FirmDashboardView';

interface DashboardViewProps {
  onNav: (view: string) => void;
}

/**
 * Plan-aware dispatcher for `/app/dashboard`.
 *
 * Solo     → personal chambers view ([SoloDashboardView])
 * Practice → my-day + chambers pulse ([PracticeDashboardView])
 * Firm     → strategic firm-wide view ([FirmDashboardView])
 *
 * Falls back to Solo when plan is absent (newly-signed-up users not yet
 * attached to a firm row).
 */
export function DashboardView({ onNav }: DashboardViewProps) {
  const plan = useAuthStore((s) => s.user?.plan);

  if (plan === 'Firm') return <FirmDashboardView />;
  if (plan === 'Practice') return <PracticeDashboardView onNav={onNav} />;
  return <SoloDashboardView onNav={onNav} />;
}
