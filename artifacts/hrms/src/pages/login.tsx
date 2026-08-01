import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, Languages, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { sessionExpired, nextPath } = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const rawNext = params.get('next') ?? '';
    // Only accept in-app paths — never external URLs (protects against open redirects).
    const safeNext =
      rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('/login')
        ? rawNext
        : '/';
    return { sessionExpired: params.get('expired') === '1', nextPath: safeNext };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      setLocation(nextPath);
    } catch (err: any) {
      if (lang === 'ar' && err.errorAr) {
        setError(err.errorAr);
      } else {
        setError(err.message || 'Login failed. Please check your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full">
      {/* Left Panel - Hidden on mobile */}
      <div className="hidden md:flex md:w-[60%] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-40"></div>
        
        <div className="relative z-10 flex flex-col items-center justify-center w-full px-16 text-white">
          <div className="w-24 h-24 rounded-full bg-amber-500/20 border-2 border-amber-500 flex items-center justify-center mb-6 backdrop-blur-sm">
            <ShieldCheck className="w-12 h-12 text-amber-500" strokeWidth={1.5} />
          </div>
          
          <h1 className="text-5xl font-bold tracking-tight mb-4 text-center">
            HRMS COMMAND
          </h1>
          
          <p className="text-xl text-slate-300 mb-2 text-center">
            Enterprise Human Resources Management
          </p>
          <p className="text-xl text-slate-300 mb-12 text-center font-arabic" dir="rtl">
            إدارة الموارد البشرية المؤسسية
          </p>

          <div className="absolute bottom-12 start-1/2 -translate-x-1/2">
            <div className="border border-amber-500/40 text-amber-500 px-6 py-2 rounded-md backdrop-blur-sm bg-amber-500/5 text-sm font-mono tracking-wider">
              CONTROLLED ACCESS
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full md:w-[40%] flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md">
          {/* Language Toggle */}
          <div className="flex justify-end mb-8">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className="gap-2"
            >
              <Languages className="w-4 h-4" />
              {lang === 'en' ? 'العربية' : 'English'}
            </Button>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-bold tracking-tight mb-2">
              {t('Sign In', 'تسجيل الدخول')}
            </h2>
            <p className="text-muted-foreground">
              {t('Enter your credentials to access the system', 'أدخل بيانات الاعتماد للوصول إلى النظام')}
            </p>
          </div>

          {sessionExpired && !error && (
            <Alert className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t('Session expired — please sign in again.', 'انتهت الجلسة — يرجى تسجيل الدخول مرة أخرى.')}
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="username" className="text-sm font-medium">
                {t('Username', 'اسم المستخدم')}
              </label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('Enter username', 'أدخل اسم المستخدم')}
                required
                disabled={isLoading}
                className="h-11"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                {t('Password', 'كلمة المرور')}
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('Enter password', 'أدخل كلمة المرور')}
                required
                disabled={isLoading}
                className="h-11"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-base font-semibold"
              disabled={isLoading}
            >
              {isLoading ? t('Signing in...', 'جارٍ تسجيل الدخول...') : t('Sign In', 'تسجيل الدخول')}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              {t('Demo accounts: admin, fatima.zahrani, omar.ghamdi, aisha.otaibi', 'حسابات تجريبية: admin, fatima.zahrani, omar.ghamdi, aisha.otaibi')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
