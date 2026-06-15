import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { User } from '@lexdraft/types';
import { api } from '@/lib/api';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { MobileNav } from '@/components/shell/MobileNav';
import { Toast } from '@/components/shell/Toast';
import { CmdK } from '@/components/shell/CmdK';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { OfflineBanner } from '@/components/OfflineBanner';
import { SuperadminBanner } from '@/components/shell/SuperadminBanner';
import { CapExceededModal } from '@/components/CapExceededModal';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
// Route-level views are code-split so heavy deps (pdf.js, mammoth, framer-motion)
// only download when the user actually navigates to a view that needs them. The
// app shell (Sidebar/Topbar/banners) stays eager. Named exports are unwrapped to
// a default via .then(...) so prop types are preserved through React.lazy.
const LandingView = lazy(() => import('@/views/LandingView').then((m) => ({ default: m.LandingView })));
const AuthView = lazy(() => import('@/views/AuthView').then((m) => ({ default: m.AuthView })));
const SignupView = lazy(() => import('@/views/SignupView').then((m) => ({ default: m.SignupView })));
const SurveyView = lazy(() => import('@/views/SurveyView').then((m) => ({ default: m.SurveyView })));
const SurveyThanksView = lazy(() => import('@/views/SurveyThanksView').then((m) => ({ default: m.SurveyThanksView })));
const DashboardView = lazy(() => import('@/views/DashboardView').then((m) => ({ default: m.DashboardView })));
const CasesListView = lazy(() => import('@/views/CasesListView').then((m) => ({ default: m.CasesListView })));
const CaseDetailView = lazy(() => import('@/views/CaseDetailView').then((m) => ({ default: m.CaseDetailView })));
const DraftingView = lazy(() => import('@/views/DraftingView').then((m) => ({ default: m.DraftingView })));
const ContractReviewView = lazy(() => import('@/views/ContractReviewView').then((m) => ({ default: m.ContractReviewView })));
const ReviewQueueView = lazy(() => import('@/views/ReviewQueueView').then((m) => ({ default: m.ReviewQueueView })));
const MockArgumentsView = lazy(() => import('@/views/MockArgumentsView').then((m) => ({ default: m.MockArgumentsView })));
const TitleReportsView = lazy(() => import('@/views/TitleReportsView').then((m) => ({ default: m.TitleReportsView })));
const TitleReportDetailView = lazy(() => import('@/views/TitleReportDetailView').then((m) => ({ default: m.TitleReportDetailView })));
const MatterIntelView = lazy(() => import('@/views/MatterIntelView').then((m) => ({ default: m.MatterIntelView })));
const TasksView = lazy(() => import('@/views/TasksView').then((m) => ({ default: m.TasksView })));
const DocumentsView = lazy(() => import('@/views/DocumentsView').then((m) => ({ default: m.DocumentsView })));
const ResearchView = lazy(() => import('@/views/ResearchView').then((m) => ({ default: m.ResearchView })));
const SettingsView = lazy(() => import('@/views/SettingsView').then((m) => ({ default: m.SettingsView })));
const CalendarView = lazy(() => import('@/views/CalendarView').then((m) => ({ default: m.CalendarView })));
const ClientsView = lazy(() => import('@/views/ClientsView').then((m) => ({ default: m.ClientsView })));
const LeadsView = lazy(() => import('@/views/LeadsView').then((m) => ({ default: m.LeadsView })));
const ClausesView = lazy(() => import('@/views/ClausesView').then((m) => ({ default: m.ClausesView })));
const InvoicesView = lazy(() => import('@/views/InvoicesView').then((m) => ({ default: m.InvoicesView })));
const ExpensesView = lazy(() => import('@/views/ExpensesView').then((m) => ({ default: m.ExpensesView })));
const LimitationView = lazy(() => import('@/views/LimitationView').then((m) => ({ default: m.LimitationView })));
const DiaryView = lazy(() => import('@/views/DiaryView').then((m) => ({ default: m.DiaryView })));
const CauseListView = lazy(() => import('@/views/CauseListView').then((m) => ({ default: m.CauseListView })));
const EcourtsView = lazy(() => import('@/views/EcourtsView').then((m) => ({ default: m.EcourtsView })));
const StampView = lazy(() => import('@/views/StampView').then((m) => ({ default: m.StampView })));
const ArchiveView = lazy(() => import('@/views/ArchiveView').then((m) => ({ default: m.ArchiveView })));
const PhysicalDocsView = lazy(() => import('@/views/PhysicalDocsView').then((m) => ({ default: m.PhysicalDocsView })));
const MembersView = lazy(() => import('@/views/MembersView').then((m) => ({ default: m.MembersView })));
const AnalyticsView = lazy(() => import('@/views/AnalyticsView').then((m) => ({ default: m.AnalyticsView })));
const FirmDashboardView = lazy(() => import('@/views/FirmDashboardView').then((m) => ({ default: m.FirmDashboardView })));
const PortalInboxView = lazy(() => import('@/views/PortalInboxView').then((m) => ({ default: m.PortalInboxView })));
const InviteAcceptView = lazy(() => import('@/views/InviteAcceptView').then((m) => ({ default: m.InviteAcceptView })));
const ManageView = lazy(() => import('@/views/manage/ManageView').then((m) => ({ default: m.ManageView })));
const SanhitaView = lazy(() => import('@/views/SanhitaView').then((m) => ({ default: m.SanhitaView })));
const CalculatorsView = lazy(() => import('@/views/CalculatorsView').then((m) => ({ default: m.CalculatorsView })));
const CoverageView = lazy(() => import('@/views/CoverageView').then((m) => ({ default: m.CoverageView })));
const PracticeAnalyticsView = lazy(() => import('@/views/PracticeAnalyticsView').then((m) => ({ default: m.PracticeAnalyticsView })));
const EngagementTemplatesView = lazy(() => import('@/views/EngagementTemplatesView').then((m) => ({ default: m.EngagementTemplatesView })));
import { MfaPromptBanner } from '@/components/MfaPromptBanner';
import { DeletionScheduledBanner } from '@/components/DeletionScheduledBanner';
import { TrialBanner } from '@/components/TrialBanner';
// Portal sub-app is code-split via React.lazy so the firm-side bundle does
// not include it (CLIENT_PORTAL.md §6.5). PortalLayout is loaded eagerly
// because every authenticated portal route mounts inside it; the views
// themselves are deferred.
import { PortalLayout } from '@/views/portal/PortalLayout';
const PortalLoginView = lazy(() =>
  import('@/views/portal/PortalLoginView').then((m) => ({ default: m.PortalLoginView })));
const PortalDashboardView = lazy(() =>
  import('@/views/portal/PortalDashboardView').then((m) => ({ default: m.PortalDashboardView })));
const PortalMatterDetailView = lazy(() =>
  import('@/views/portal/PortalMatterDetailView').then((m) => ({ default: m.PortalMatterDetailView })));
const PortalMessagesView = lazy(() =>
  import('@/views/portal/PortalMessagesView').then((m) => ({ default: m.PortalMessagesView })));
const PortalProfileView = lazy(() =>
  import('@/views/portal/PortalProfileView').then((m) => ({ default: m.PortalProfileView })));
import { AdminShell } from '@/admin/AdminShell';
const AdminDashboardView = lazy(() => import('@/admin/views/AdminDashboardView').then((m) => ({ default: m.AdminDashboardView })));
const AiUsageView = lazy(() => import('@/admin/views/AiUsageView').then((m) => ({ default: m.AiUsageView })));
const AdminFirmsView = lazy(() => import('@/admin/views/FirmsView').then((m) => ({ default: m.FirmsView })));
const AdminFirmDetailView = lazy(() => import('@/admin/views/FirmDetailView').then((m) => ({ default: m.FirmDetailView })));
const AdminUsersView = lazy(() => import('@/admin/views/UsersView').then((m) => ({ default: m.UsersView })));
const AuditLogView = lazy(() => import('@/admin/views/AuditLogView').then((m) => ({ default: m.AuditLogView })));
const TemplatesView = lazy(() => import('@/admin/views/TemplatesView').then((m) => ({ default: m.TemplatesView })));
const ErrorLogView = lazy(() => import('@/admin/views/ErrorLogView').then((m) => ({ default: m.ErrorLogView })));
import { ImpersonationBanner } from '@/admin/ImpersonationBanner';

export function App() {
  const user = useAuthStore((s) => s.user);
  const actAs = useAuthStore((s) => s.actAs);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const location = useLocation();
  const navigate = useNavigate();
  const cmdK = useUIStore((s) => s.cmdK);
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);

  // Shared fallback while a code-split route chunk downloads.
  const pageFallback = (
    <div style={{ padding: 'var(--space-9)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
      Loading…
    </div>
  );

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleCmdK(true);
      }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [toggleCmdK]);

  // Boot-refresh the cached User. Plan/role changes made server-side (e.g. an
  // admin promoted the firm to Practice) propagate without a re-login.
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/me'),
    enabled: !!user,
    staleTime: 60_000,
  });
  useEffect(() => {
    if (meQuery.data) refreshUser(meQuery.data);
  }, [meQuery.data, refreshUser]);

  const isPublic =
    location.pathname === '/' ||
    location.pathname.startsWith('/auth') ||
    location.pathname.startsWith('/signup') ||
    location.pathname.startsWith('/invite') ||
    location.pathname.startsWith('/survey');

  // Client portal lives in its own auth space (magic-link → portal JWT). It
  // does NOT depend on the advocate session in `useAuthStore`, so the rest of
  // the routing tree (including the auth gate below) is short-circuited.
  const isPortalRoute = location.pathname.startsWith('/portal');

  const isAdminRoute = location.pathname.startsWith('/admin');

  if (isPortalRoute) {
    return (
      <>
        <Suspense fallback={<div style={{ padding: 32, textAlign: 'center', opacity: 0.6 }}>Loading…</div>}>
          <Routes>
            <Route path="/portal" element={<Navigate to="/portal/login" replace />} />
            <Route path="/portal/login" element={<PortalLoginView />} />
            {/* Legacy magic-link path - bounce anyone landing here back to sign-in. */}
            <Route path="/portal/verify" element={<Navigate to="/portal/login" replace />} />
            <Route element={<PortalLayout />}>
              <Route path="/portal/dashboard" element={<PortalDashboardView />} />
              <Route path="/portal/matters/:id" element={<PortalMatterDetailView />} />
              <Route path="/portal/messages" element={<PortalMessagesView />} />
              <Route path="/portal/profile" element={<PortalProfileView />} />
            </Route>
            <Route path="/portal/*" element={<Navigate to="/portal/login" replace />} />
          </Routes>
        </Suspense>
        <Toast />
      </>
    );
  }

  if (isPublic) {
    return (
      <>
        <Suspense fallback={pageFallback}>
          <Routes>
            <Route path="/" element={<LandingView />} />
            <Route path="/auth/*" element={<AuthView />} />
            <Route path="/signup" element={<SignupView />} />
            <Route path="/invite/:token" element={<InviteAcceptView />} />
            <Route path="/survey" element={<SurveyView />} />
            <Route path="/survey/thanks" element={<SurveyThanksView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <Toast />
        {cmdK && <CmdK />}
      </>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  if (isAdminRoute) {
    if (!user.isSuperadmin) {
      return <Navigate to="/app/dashboard" replace />;
    }
    return (
      <>
        <Suspense fallback={pageFallback}>
          <Routes>
            <Route path="/admin" element={<AdminShell />}>
              <Route index element={<AdminDashboardView />} />
              <Route path="firms" element={<AdminFirmsView />} />
              <Route path="firms/:id" element={<AdminFirmDetailView />} />
              <Route path="users" element={<AdminUsersView />} />
              <Route path="ai-usage" element={<AiUsageView />} />
              <Route path="audit" element={<AuditLogView />} />
              <Route path="templates" element={<TemplatesView />} />
              <Route path="errors" element={<ErrorLogView />} />
            </Route>
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </Suspense>
        <Toast />
        {cmdK && <CmdK />}
      </>
    );
  }

  return (
    <>
      <OfflineBanner />
      <ImpersonationBanner />
      {user.isSuperadmin && !actAs && <SuperadminBanner />}
      <DeletionScheduledBanner />
      <TrialBanner />
      <MfaPromptBanner />
      <a href="#main-content" className="skip-link">Skip to content</a>
      <div className="app">
        <Sidebar />
        <div className="main">
          <Topbar />
          <main className="content" id="main-content" tabIndex={-1} key={location.pathname}>
            <Suspense fallback={pageFallback}>
            <Routes>
              <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
              <Route path="/app/dashboard" element={<DashboardView onNav={(v) => navigate(`/app/${v}`)} />} />
              <Route path="/app/cases" element={<CasesListView onOpen={(c) => navigate(`/app/cases/${c.id}`)} />} />
              <Route path="/app/cases/:id" element={<CaseDetailView />} />
              <Route path="/app/draft" element={<DraftingView />} />
              <Route path="/app/review" element={<ContractReviewView />} />
              <Route path="/app/review-queue" element={<ReviewQueueView />} />
              <Route path="/app/mock-arguments" element={<MockArgumentsView />} />
              <Route path="/app/title-reports" element={<TitleReportsView />} />
              <Route path="/app/title-reports/:id" element={<TitleReportDetailView />} />
              <Route path="/app/matter-intel"          element={<MatterIntelView />} />
              <Route path="/app/matter-intel/:caseId" element={<MatterIntelView />} />
              <Route path="/app/tasks" element={<TasksView />} />
              <Route path="/app/documents" element={<DocumentsView />} />
              <Route path="/app/research" element={<ResearchView />} />
              <Route path="/app/settings" element={<SettingsView />} />
              <Route path="/app/calendar"   element={<CalendarView />} />
              <Route path="/app/clients"    element={<ClientsView />} />
              <Route path="/app/leads"      element={<LeadsView />} />
              <Route path="/app/clauses"    element={<ClausesView />} />
              <Route path="/app/invoices"   element={<InvoicesView />} />
              <Route path="/app/expenses"   element={<ExpensesView />} />
              <Route path="/app/limitation" element={<LimitationView />} />
              <Route path="/app/diary"      element={<DiaryView />} />
              <Route path="/app/causelist"  element={<CauseListView />} />
              <Route path="/app/ecourts"    element={<EcourtsView />} />
              <Route path="/app/stamp"      element={<StampView />} />
              <Route path="/app/archive"    element={<ArchiveView />} />
              <Route path="/app/physical-docs" element={<PhysicalDocsView />} />
              <Route path="/app/firm"       element={<FirmDashboardView />} />
              <Route path="/app/members"    element={<MembersView />} />
              <Route path="/app/manage"     element={<ManageView />} />
              <Route path="/app/messages"   element={<PortalInboxView />} />
              <Route path="/app/analytics"  element={<AnalyticsView />} />
              <Route path="/app/sanhita"             element={<SanhitaView />} />
              <Route path="/app/calculators"         element={<CalculatorsView />} />
              <Route path="/app/coverage"            element={<CoverageView />} />
              <Route path="/app/practice-analytics"  element={<PracticeAnalyticsView />} />
              <Route path="/app/engagement"          element={<EngagementTemplatesView />} />
              <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
            </Routes>
            </Suspense>
          </main>
        </div>
        <MobileNav />
      </div>
      <Toast />
      <CapExceededModal />
      {cmdK && <CmdK />}
      <KeyboardShortcuts />
    </>
  );
}
