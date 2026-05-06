import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
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
import { MembersView } from '@/views/MembersView';
import { AnalyticsView } from '@/views/AnalyticsView';
import { FirmDashboardView } from '@/views/FirmDashboardView';
import { InviteAcceptView } from '@/views/InviteAcceptView';
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

  const isPublic =
    location.pathname === '/' ||
    location.pathname.startsWith('/auth') ||
    location.pathname.startsWith('/invite');

  const isAdminRoute = location.pathname.startsWith('/admin');

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
              <Route path="/app/firm"       element={<FirmDashboardView />} />
              <Route path="/app/members"    element={<MembersView />} />
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
