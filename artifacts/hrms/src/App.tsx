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
