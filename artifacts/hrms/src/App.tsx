import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { ThemeProvider } from '@/components/theme-provider';
import { LanguageProvider } from '@/hooks/use-language';
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
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

function Router() {
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
        <Route path="/alerts" component={Alerts} />
        <Route path="/users" component={Users} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="hrms-theme">
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
