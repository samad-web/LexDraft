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
import { SuperadminBanner } from '@/components/shell/SuperadminBanner';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { LandingView } from '@/views/LandingView';
import { AuthView } from '@/views/AuthView';
import { DashboardView } from '@/views/DashboardView';
import { CasesListView } from '@/views/CasesListView';
import { CaseDetailView } from '@/views/CaseDetailView';
import { DraftingView } from '@/views/DraftingView';
import { ContractReviewView } from '@/views/ContractReviewView';
import { TasksView } from '@/views/TasksView';
import { DocumentsView } from '@/views/DocumentsView';
import { ResearchView } from '@/views/ResearchView';
import { SettingsView } from '@/views/SettingsView';
import { CalendarView } from '@/views/CalendarView';
import { ClientsView } from '@/views/ClientsView';
import { LeadsView } from '@/views/LeadsView';
import { ClausesView } from '@/views/ClausesView';
import { InvoicesView } from '@/views/InvoicesView';
import { ExpensesView } from '@/views/ExpensesView';
import { LimitationView } from '@/views/LimitationView';
import { DiaryView } from '@/views/DiaryView';
import { CauseListView } from '@/views/CauseListView';
import { EcourtsView } from '@/views/EcourtsView';
import { StampView } from '@/views/StampView';
import { ArchiveView } from '@/views/ArchiveView';
import { PhysicalDocsView } from '@/views/PhysicalDocsView';
import { MembersView } from '@/views/MembersView';
import { AnalyticsView } from '@/views/AnalyticsView';
import { FirmDashboardView } from '@/views/FirmDashboardView';
import { PortalInboxView } from '@/views/PortalInboxView';
import { InviteAcceptView } from '@/views/InviteAcceptView';
import { ManageView } from '@/views/manage/ManageView';
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
import { AdminDashboardView } from '@/admin/views/AdminDashboardView';
import { FirmsView as AdminFirmsView } from '@/admin/views/FirmsView';
import { FirmDetailView as AdminFirmDetailView } from '@/admin/views/FirmDetailView';
import { UsersView as AdminUsersView } from '@/admin/views/UsersView';
import { AuditLogView } from '@/admin/views/AuditLogView';
import { TemplatesView } from '@/admin/views/TemplatesView';
import { ImpersonationBanner } from '@/admin/ImpersonationBanner';

export function App() {
  const user = useAuthStore((s) => s.user);
  const actAs = useAuthStore((s) => s.actAs);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const location = useLocation();
  const navigate = useNavigate();
  const cmdK = useUIStore((s) => s.cmdK);
  const toggleCmdK = useUIStore((s) => s.toggleCmdK);

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
    location.pathname.startsWith('/invite');

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
            <Route path="/portal/verify" element={<PortalLoginView />} />
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
        <Routes>
          <Route path="/" element={<LandingView />} />
          <Route path="/auth/*" element={<AuthView />} />
          <Route path="/invite/:token" element={<InviteAcceptView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
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
        <Routes>
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<AdminDashboardView />} />
            <Route path="firms" element={<AdminFirmsView />} />
            <Route path="firms/:id" element={<AdminFirmDetailView />} />
            <Route path="users" element={<AdminUsersView />} />
            <Route path="audit" element={<AuditLogView />} />
            <Route path="templates" element={<TemplatesView />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        <Toast />
        {cmdK && <CmdK />}
      </>
    );
  }

  return (
    <>
      <ImpersonationBanner />
      {user.isSuperadmin && !actAs && <SuperadminBanner />}
      <div className="app">
        <Sidebar />
        <div className="main">
          <Topbar />
          <div className="content" key={location.pathname}>
            <Routes>
              <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
              <Route path="/app/dashboard" element={<DashboardView onNav={(v) => navigate(`/app/${v}`)} />} />
              <Route path="/app/cases" element={<CasesListView onOpen={(c) => navigate(`/app/cases/${c.id}`)} />} />
              <Route path="/app/cases/:id" element={<CaseDetailView />} />
              <Route path="/app/draft" element={<DraftingView />} />
              <Route path="/app/review" element={<ContractReviewView />} />
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
              <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
            </Routes>
          </div>
        </div>
        <MobileNav />
      </div>
      <Toast />
      {cmdK && <CmdK />}
    </>
  );
}
