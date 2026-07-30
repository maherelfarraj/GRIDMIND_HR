import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, AlertCircle } from 'lucide-react';
import { getPasswordIssues, PASSWORD_REQUIREMENTS_EN, PASSWORD_REQUIREMENTS_AR } from '@workspace/api-zod';

/**
 * Mandatory password-change screen. Rendered instead of the app shell when
 * the signed-in user has mustChangePassword set (provisioned demo password
 * or admin reset). The user cannot reach any other page until the flag
 * clears server-side.
 */
export default function ForcePasswordChange() {
  const { changePassword, logout } = useAuth();
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const issues = getPasswordIssues(newPassword);
    if (issues.length > 0) {
      setError(t(issues.map((i) => i.messageEn).join('. '), issues.map((i) => i.messageAr).join('. ')));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('Passwords do not match.', 'كلمتا المرور غير متطابقتين.'));
      return;
    }
    setIsLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
      // Success: mustChangePassword clears in the auth context and the
      // router lets the user through automatically.
    } catch (err: any) {
      setError(err.message || t('Password change failed.', 'فشل تغيير كلمة المرور.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/40">
            <KeyRound className="h-7 w-7 text-amber-500" strokeWidth={1.5} />
          </div>
          <h2 className="text-2xl font-bold tracking-tight mb-2">
            {t('Change Your Password', 'غيّر كلمة المرور الخاصة بك')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t(
              'Your account was set up with a temporary password. You must choose a new password before continuing.',
              'تم إعداد حسابك بكلمة مرور مؤقتة. يجب اختيار كلمة مرور جديدة قبل المتابعة.'
            )}
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="current-password" className="text-sm font-medium">
              {t('Current Password', 'كلمة المرور الحالية')}
            </label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={isLoading}
              autoComplete="current-password"
              className="h-11"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="new-password" className="text-sm font-medium">
              {t('New Password', 'كلمة المرور الجديدة')}
            </label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              disabled={isLoading}
              autoComplete="new-password"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              {t(PASSWORD_REQUIREMENTS_EN, PASSWORD_REQUIREMENTS_AR)}
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="confirm-password" className="text-sm font-medium">
              {t('Confirm New Password', 'تأكيد كلمة المرور الجديدة')}
            </label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              disabled={isLoading}
              autoComplete="new-password"
              className="h-11"
            />
          </div>

          <Button type="submit" className="w-full h-11 text-base font-semibold" disabled={isLoading}>
            {isLoading
              ? t('Updating...', 'جارٍ التحديث...')
              : t('Set New Password', 'تعيين كلمة المرور الجديدة')}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Button variant="ghost" size="sm" onClick={() => logout()} disabled={isLoading}>
            {t('Sign out', 'تسجيل الخروج')}
          </Button>
        </div>
      </div>
    </div>
  );
}
