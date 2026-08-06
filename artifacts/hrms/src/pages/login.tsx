import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Languages, AlertCircle } from 'lucide-react';
import { GridMindIconMark } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';

// Human-friendly wait duration: seconds under a minute, minutes otherwise.
function formatRetryDuration(seconds: number, lang: 'en' | 'ar'): string {
  if (seconds < 60) {
    return lang === 'ar' ? `${seconds} ثانية` : `${seconds} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (lang === 'ar') {
    return minutes === 1 ? 'دقيقة واحدة' : `${minutes} دقائق`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Seconds remaining in an active lockout window (null = not locked out).
  // Drives a live countdown in the error message and disables the login
  // button until the wait is over.
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number | null>(null);

  // Tick the lockout countdown once per second; when it reaches zero, clear
  // the lockout message and re-enable the login button.
  useEffect(() => {
    if (lockoutSecondsLeft === null) return;
    if (lockoutSecondsLeft <= 0) {
      setLockoutSecondsLeft(null);
      setError('');
      return;
    }
    const timer = setTimeout(() => {
      setLockoutSecondsLeft((s) => (s === null ? null : s - 1));
    }, 1000);
    return () => clearTimeout(timer);
  }, [lockoutSecondsLeft]);

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
      const message =
        lang === 'ar' && err.errorAr
          ? err.errorAr
          : err.message || 'Login failed. Please check your credentials.';
      setError(message);
      if (typeof err.retryAfterSeconds === 'number' && err.retryAfterSeconds > 0) {
        setLockoutSecondsLeft(Math.ceil(err.retryAfterSeconds));
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
          <GridMindIconMark size={88} className="mb-8 drop-shadow-lg" />

          <h1 className="text-5xl font-bold tracking-tight mb-4 text-center">
            <span className="text-white">GridMind</span>
            <span className="text-[#22C55E]">HR</span>
          </h1>

          <p className="text-lg font-semibold mb-2 text-center tracking-wide text-[#0EA5A3]">
            People. Insights. Impact.
          </p>
          <p className="text-base text-slate-400 mb-12 text-center font-arabic" dir="rtl">
            الأفراد. الرؤى. الأثر.
          </p>

          <div className="absolute bottom-12 start-1/2 -translate-x-1/2">
            <div className="border border-[#0EA5A3]/40 text-[#0EA5A3] px-6 py-2 rounded-md backdrop-blur-sm bg-[#0EA5A3]/5 text-sm tracking-wider whitespace-nowrap">
              Enterprise HR Platform
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
              <AlertDescription>
                {error}
                {lockoutSecondsLeft !== null && lockoutSecondsLeft > 0
                  ? lang === 'ar'
                    ? ` يمكنك المحاولة مرة أخرى بعد ${formatRetryDuration(lockoutSecondsLeft, 'ar')}.`
                    : ` You can try again in ${formatRetryDuration(lockoutSecondsLeft, 'en')}.`
                  : null}
              </AlertDescription>
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
              disabled={isLoading || (lockoutSecondsLeft !== null && lockoutSecondsLeft > 0)}
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
