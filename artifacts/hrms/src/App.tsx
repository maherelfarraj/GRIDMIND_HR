import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { ThemeProvider } from '@/components/theme-provider';
import { LanguageProvider } from '@/hooks/use-language';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { Shell } from '@/components/layout/Shell';

// Pages
import Dashboard from '@/pages/dashboard';
import Employees from '@/pages/employees';
import EmployeeDetail from '@/pages/employees/[id]';
import Departments from '@/pages/departments';
import Roles from '@/pages/roles';
import Documents from '@/pages/documents';
import Approvals from '@/pages/approvals';
import Audit from '@/pages/audit';
import Attendance from '@/pages/attendance';
import Devices from '@/pages/devices';
import Alerts from '@/pages/alerts';
import Users from '@/pages/users';
import Login from '@/pages/login';
import NotFound from '@/pages/not-found';
import Shifts from '@/pages/shifts';
import Rosters from '@/pages/rosters';
import Overtime from '@/pages/overtime';
import PunchEvents from '@/pages/punch-events';
import Leave from '@/pages/leave';
import LeaveBalances from '@/pages/leave-balances';
import LeaveConfig from '@/pages/leave-config';
import Payroll from '@/pages/payroll';
import PayrollPayslip from '@/pages/payroll-payslip';
import SalaryGrades from '@/pages/salary-grades';
import PayComponents from '@/pages/pay-components';
import SystemConfig from '@/pages/system-config';
import MilitaryHierarchy from '@/pages/military-hierarchy';
import DutyStations from '@/pages/duty-stations';
import Postings from '@/pages/postings';
import SecurityClearances from '@/pages/security-clearances';
import Mobilization from '@/pages/mobilization';
import SecuritySettings from '@/pages/security-settings';
import AdminAirgap from '@/pages/admin-airgap';
import Recruitment from '@/pages/recruitment';
import RecruitmentApplication from '@/pages/recruitment-application';
import Onboarding from '@/pages/onboarding';
import Probation from '@/pages/probation';
import Performance from '@/pages/performance';
import Disciplinary from '@/pages/disciplinary';
import Training from '@/pages/training';
import Skills from '@/pages/skills';
import Succession from '@/pages/succession';
import MyPortal from '@/pages/my-portal';
import ManagerPortal from '@/pages/manager-portal';
import DocumentManagement from '@/pages/document-management';
import Reports from '@/pages/reports';
import Notifications from '@/pages/notifications';
import Deployment from '@/pages/deployment';
import ProductionReadiness from '@/pages/production-readiness';
import WorkforceAnalytics from '@/pages/workforce-analytics';
import ReportBuilder from '@/pages/report-builder';
import IntegrationCenter from '@/pages/integration-center';
import Organizations from '@/pages/organizations';
import OrgBranding from '@/pages/org-branding';
import PolicyLocalization from '@/pages/policy-localization';
import PolicyGovernance from '@/pages/policy-governance';
import IntegrationGovernance from '@/pages/integration-governance';
import ConfigPackages from '@/pages/config-packages';
import LocalAi from '@/pages/local-ai';
import SetupWizard from '@/pages/setup-wizard';
import DataImport from '@/pages/data-import';
import Diagnostics from '@/pages/diagnostics';
import GoLiveChecklist from '@/pages/go-live-checklist';
import Licensing from '@/pages/licensing';
import Pilot from '@/pages/pilot';
import PilotControlCenter from '@/pages/pilot-control-center';
import UATScripts from '@/pages/uat-scripts';
import SecurityTests from '@/pages/security-tests';

const queryClient = new QueryClient();

function ProtectedRouter() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user && location !== '/login') {
    return <Redirect to="/login" />;
  }

  if (user && location === '/login') {
    return <Redirect to="/" />;
  }

  if (location === '/login') {
    return <Login />;
  }

  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/employees" component={Employees} />
        <Route path="/employees/:id" component={EmployeeDetail} />
        <Route path="/departments" component={Departments} />
        <Route path="/roles" component={Roles} />
        <Route path="/documents" component={Documents} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/audit" component={Audit} />
        <Route path="/attendance" component={Attendance} />
        <Route path="/devices" component={Devices} />
        <Route path="/shifts" component={Shifts} />
        <Route path="/rosters" component={Rosters} />
        <Route path="/overtime" component={Overtime} />
        <Route path="/punch-events" component={PunchEvents} />
        <Route path="/alerts" component={Alerts} />
        <Route path="/users" component={Users} />
        <Route path="/leave" component={Leave} />
        <Route path="/leave-balances" component={LeaveBalances} />
        <Route path="/leave-config" component={LeaveConfig} />
        <Route path="/payroll/payslip/:id" component={PayrollPayslip} />
        <Route path="/payroll/grades" component={SalaryGrades} />
        <Route path="/payroll/components" component={PayComponents} />
        <Route path="/payroll" component={Payroll} />
        <Route path="/system-config" component={SystemConfig} />
        <Route path="/military-hierarchy" component={MilitaryHierarchy} />
        <Route path="/duty-stations" component={DutyStations} />
        <Route path="/postings" component={Postings} />
        <Route path="/security-clearances" component={SecurityClearances} />
        <Route path="/mobilization" component={Mobilization} />
        <Route path="/security-settings" component={SecuritySettings} />
        <Route path="/admin-airgap" component={AdminAirgap} />
        <Route path="/recruitment/applications/:id" component={RecruitmentApplication} />
        <Route path="/recruitment" component={Recruitment} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/probation" component={Probation} />
        <Route path="/performance" component={Performance} />
        <Route path="/disciplinary" component={Disciplinary} />
        <Route path="/training" component={Training} />
        <Route path="/skills" component={Skills} />
        <Route path="/succession" component={Succession} />
        <Route path="/my" component={MyPortal} />
        <Route path="/manager" component={ManagerPortal} />
        <Route path="/document-management" component={DocumentManagement} />
        <Route path="/reports" component={Reports} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/deployment" component={Deployment} />
        <Route path="/production-readiness" component={ProductionReadiness} />
        <Route path="/workforce-analytics" component={WorkforceAnalytics} />
        <Route path="/report-builder" component={ReportBuilder} />
        <Route path="/integration-center" component={IntegrationCenter} />
        <Route path="/organizations" component={Organizations} />
        <Route path="/org-branding" component={OrgBranding} />
        <Route path="/policy-localization" component={PolicyLocalization} />
        <Route path="/policy-governance" component={PolicyGovernance} />
        <Route path="/integration-governance" component={IntegrationGovernance} />
        <Route path="/config-packages" component={ConfigPackages} />
        <Route path="/local-ai" component={LocalAi} />
        <Route path="/setup-wizard" component={SetupWizard} />
        <Route path="/data-import" component={DataImport} />
        <Route path="/diagnostics" component={Diagnostics} />
        <Route path="/go-live-checklist" component={GoLiveChecklist} />
        <Route path="/licensing" component={Licensing} />
        <Route path="/pilot" component={Pilot} />
        <Route path="/pilot-control-center" component={PilotControlCenter} />
        <Route path="/uat-scripts" component={UATScripts} />
        <Route path="/security-tests" component={SecurityTests} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="hrms-theme">
      <LanguageProvider>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
                <ProtectedRouter />
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </QueryClientProvider>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
