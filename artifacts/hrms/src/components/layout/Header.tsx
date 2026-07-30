import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/components/theme-provider';
import { useAuth } from '@/hooks/use-auth';
import { useListAlerts, useChangeMyPassword } from '@workspace/api-client-react';
import { Moon, Sun, Languages, Bell, Search, Menu, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { lang, setLang, t } = useLanguage();
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { data: alerts } = useListAlerts();
  const { toast } = useToast();
  const changeMyPassword = useChangeMyPassword();

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const closePasswordDialog = () => {
    setPasswordDialogOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangePassword = () => {
    if (!currentPassword) {
      toast({ title: t('Current password required', 'كلمة المرور الحالية مطلوبة'), variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: t('Password too short', 'كلمة المرور قصيرة جداً'), description: t('New password must be at least 8 characters.', 'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.'), variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t('Passwords do not match', 'كلمتا المرور غير متطابقتين'), variant: 'destructive' });
      return;
    }
    changeMyPassword.mutate(
      { data: { currentPassword, newPassword } },
      {
        onSuccess: () => {
          toast({ title: t('Password changed', 'تم تغيير كلمة المرور'), description: t('Use your new password the next time you sign in.', 'استخدم كلمة المرور الجديدة عند تسجيل الدخول في المرة القادمة.') });
          closePasswordDialog();
        },
        onError: (error: unknown) => {
          const status = (error as { status?: number })?.status;
          toast({
            title: t('Failed to change password', 'فشل تغيير كلمة المرور'),
            description: status === 401
              ? t('The current password you entered is incorrect.', 'كلمة المرور الحالية التي أدخلتها غير صحيحة.')
              : t('Please check your input and try again.', 'يرجى التحقق من المدخلات والمحاولة مرة أخرى.'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const unacknowledgedCount = alerts?.filter(a => !a.acknowledgedAt).length || 0;
  const userInitial = user ? (lang === 'en' ? user.fullNameEn.charAt(0) : user.fullNameAr.charAt(0)) : 'A';

  return (
    <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick}>
          <Menu className="w-5 h-5" />
        </Button>
        <div className="relative hidden sm:block w-64">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input 
            placeholder={t('Search anywhere...', 'البحث في كل مكان...')} 
            className="ps-9 bg-background/50 border-muted h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="w-9 h-9">
              <Languages className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setLang('en')} className={lang === 'en' ? 'bg-accent' : ''}>
              English
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setLang('ar')} className={lang === 'ar' ? 'bg-accent' : ''}>
              العربية (Arabic)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="w-9 h-9">
              {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="ghost" size="icon" className="w-9 h-9 relative">
          <Bell className="w-4 h-4" />
          {unacknowledgedCount > 0 && (
            <span className="absolute top-2 end-2 w-2 h-2 bg-destructive rounded-full" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-8 w-8 ms-2 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-semibold text-sm uppercase"
              aria-label={t('Account menu', 'قائمة الحساب')}
            >
              {userInitial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setPasswordDialogOpen(true)}>
              <KeyRound className="w-4 h-4 me-2" />
              {t('Change Password', 'تغيير كلمة المرور')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={passwordDialogOpen} onOpenChange={(open) => { if (!open) closePasswordDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Change Password', 'تغيير كلمة المرور')}</DialogTitle>
            <DialogDescription>
              {t('Enter your current password, then choose a new one. It is hashed on the server and never stored in plain text.', 'أدخل كلمة المرور الحالية ثم اختر كلمة جديدة. يتم تشفيرها على الخادم ولا تُخزن كنص عادي أبداً.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">{t('Current Password', 'كلمة المرور الحالية')}</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="self-new-password">{t('New Password', 'كلمة المرور الجديدة')}</Label>
              <Input
                id="self-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('At least 8 characters', '8 أحرف على الأقل')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="self-confirm-password">{t('Confirm New Password', 'تأكيد كلمة المرور الجديدة')}</Label>
              <Input
                id="self-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePasswordDialog}>{t('Cancel', 'إلغاء')}</Button>
            <Button onClick={handleChangePassword} disabled={changeMyPassword.isPending}>
              {changeMyPassword.isPending ? t('Saving...', 'جارٍ الحفظ...') : t('Change Password', 'تغيير كلمة المرور')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
