import { useEffect, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { useListUsers, useCreateUser, useGetUser, useUpdateUser, getGetUserQueryKey, useSetUserPassword, useUnlockUser, useIssueOneTimePassword, getListUsersQueryKey, useListRoles, getListRolesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Server, Search, Shield, UserCog, MoreHorizontal, KeyRound, Lock, LockOpen, Ticket, Copy, Check, Hourglass, Pencil } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { getPasswordIssues, PASSWORD_REQUIREMENTS_EN, PASSWORD_REQUIREMENTS_AR } from '@workspace/api-zod';

export default function Users() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const { data: usersData, isLoading } = useListUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const { data: userDetail } = useGetUser(1, { query: { enabled: false, queryKey: getGetUserQueryKey(1) } });
  const setUserPassword = useSetUserPassword();
  const unlockUser = useUnlockUser();
  const queryClient = useQueryClient();

  const isLocked = (lockedUntil: string | null | undefined) =>
    !!lockedUntil && new Date(lockedUntil).getTime() > Date.now();

  // Deep-link support: security alerts link here as /users?highlight=<username>
  // so the admin lands with the affected (locked) account highlighted and
  // scrolled into view — verify, then unlock from the row's action menu.
  const search = useSearch();
  const highlightUsername = new URLSearchParams(search).get('highlight');
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (!scrolledRef.current && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledRef.current = true;
    }
  }, [usersData, highlightUsername]);

  const handleUnlock = (id: number, name: string) => {
    unlockUser.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: t('Account unlocked', 'تم إلغاء قفل الحساب'), description: t(`${name} can sign in again immediately.`, `يمكن لـ ${name} تسجيل الدخول مرة أخرى فورًا.`) });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: () => {
          toast({ title: t('Failed to unlock account', 'فشل إلغاء قفل الحساب'), variant: 'destructive' });
        },
      },
    );
  };

  // --- One-time password issuance -------------------------------------
  // Two-step: confirm intent (it replaces the current password and signs the
  // user out everywhere), then show the generated OTP exactly once. It is
  // never fetched again — closing the dialog discards it for good.
  const issueOtp = useIssueOneTimePassword();
  const [otpTarget, setOtpTarget] = useState<{ id: number; name: string } | null>(null);
  const [issuedOtp, setIssuedOtp] = useState<{ name: string; oneTimePassword: string; username: string } | null>(null);
  const [otpCopied, setOtpCopied] = useState(false);

  const handleIssueOtp = () => {
    if (!otpTarget) return;
    const target = otpTarget;
    issueOtp.mutate(
      { id: target.id },
      {
        onSuccess: (data) => {
          setOtpTarget(null);
          setOtpCopied(false);
          setIssuedOtp({ name: target.name, oneTimePassword: data.oneTimePassword, username: data.username });
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: () => {
          toast({ title: t('Failed to issue one-time password', 'فشل إصدار كلمة المرور لمرة واحدة'), variant: 'destructive' });
        },
      },
    );
  };

  const copyOtp = async () => {
    if (!issuedOtp) return;
    try {
      await navigator.clipboard.writeText(issuedOtp.oneTimePassword);
      setOtpCopied(true);
      setTimeout(() => setOtpCopied(false), 2000);
    } catch {
      toast({ title: t('Could not copy — select and copy manually', 'تعذر النسخ — حدد وانسخ يدويًا'), variant: 'destructive' });
    }
  };

  // --- Invite user (create account) ------------------------------------
  // On success we roll straight into the existing OTP-issuance confirm
  // dialog for the new account, so the admin leaves with a working
  // one-time credential to hand to the person.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUsername, setInviteUsername] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNameEn, setInviteNameEn] = useState('');
  const [inviteNameAr, setInviteNameAr] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState<string>('');
  const { data: rolesData } = useListRoles({ query: { enabled: inviteOpen, queryKey: getListRolesQueryKey() } });

  const closeInviteDialog = () => {
    setInviteOpen(false);
    setInviteUsername('');
    setInviteEmail('');
    setInviteNameEn('');
    setInviteNameAr('');
    setInviteRoleId('');
  };

  const handleInvite = () => {
    const username = inviteUsername.trim();
    const email = inviteEmail.trim();
    if (!/^[a-zA-Z0-9._-]{3,}$/.test(username)) {
      toast({ title: t('Username must be at least 3 characters (letters, numbers, dots, dashes)', 'يجب أن يتكون اسم المستخدم من 3 أحرف على الأقل (أحرف وأرقام ونقاط وشرطات)'), variant: 'destructive' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: t('Invalid email address', 'عنوان البريد الإلكتروني غير صالح'), variant: 'destructive' });
      return;
    }
    if (!inviteNameEn.trim() || !inviteNameAr.trim()) {
      toast({ title: t('Name cannot be empty', 'لا يمكن ترك الاسم فارغاً'), variant: 'destructive' });
      return;
    }
    if (!inviteRoleId) {
      toast({ title: t('Please choose a role', 'يرجى اختيار دور'), variant: 'destructive' });
      return;
    }
    createUser.mutate(
      {
        data: {
          username,
          email,
          fullNameEn: inviteNameEn.trim(),
          fullNameAr: inviteNameAr.trim(),
          roleId: Number(inviteRoleId),
          isActive: true,
          preferredLanguage: lang,
        },
      },
      {
        onSuccess: (created) => {
          const name = lang === 'en' ? created.fullNameEn : created.fullNameAr;
          toast({ title: t('User created', 'تم إنشاء المستخدم'), description: t(`Now issue a one-time password for ${name}.`, `الآن أصدر كلمة مرور لمرة واحدة لـ ${name}.`) });
          closeInviteDialog();
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          // Chain into the existing OTP confirm dialog for the new account.
          setOtpTarget({ id: created.id, name });
        },
        onError: () => {
          toast({ title: t('Failed to create user — the username or email may already be in use', 'فشل إنشاء المستخدم — قد يكون اسم المستخدم أو البريد الإلكتروني مستخدماً بالفعل'), variant: 'destructive' });
        },
      },
    );
  };

  // --- Edit user (email / names) ---------------------------------------
  const [editTarget, setEditTarget] = useState<{ id: number; name: string } | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editNameAr, setEditNameAr] = useState('');

  const openEditDialog = (user: { id: number; email: string; fullNameEn: string; fullNameAr: string }) => {
    setEditTarget({ id: user.id, name: lang === 'en' ? user.fullNameEn : user.fullNameAr });
    setEditEmail(user.email);
    setEditNameEn(user.fullNameEn);
    setEditNameAr(user.fullNameAr);
  };

  const handleSaveEdit = () => {
    if (!editTarget) return;
    const email = editEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: t('Invalid email address', 'عنوان البريد الإلكتروني غير صالح'), variant: 'destructive' });
      return;
    }
    if (!editNameEn.trim() || !editNameAr.trim()) {
      toast({ title: t('Name cannot be empty', 'لا يمكن ترك الاسم فارغاً'), variant: 'destructive' });
      return;
    }
    updateUser.mutate(
      { id: editTarget.id, data: { email, fullNameEn: editNameEn.trim(), fullNameAr: editNameAr.trim() } },
      {
        onSuccess: () => {
          toast({ title: t('User updated', 'تم تحديث المستخدم'), description: t(`Changes saved for ${editTarget.name}.`, `تم حفظ التغييرات لـ ${editTarget.name}.`) });
          setEditTarget(null);
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
        },
        onError: () => {
          toast({ title: t('Failed to update user', 'فشل تحديث المستخدم'), variant: 'destructive' });
        },
      },
    );
  };

  const [passwordTarget, setPasswordTarget] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const closePasswordDialog = () => {
    setPasswordTarget(null);
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSetPassword = () => {
    if (!passwordTarget) return;
    const issues = getPasswordIssues(newPassword);
    if (issues.length > 0) {
      toast({
        title: t('Password too weak', 'كلمة المرور ضعيفة جداً'),
        description: t(issues.map((i) => i.messageEn).join('. '), issues.map((i) => i.messageAr).join('. ')),
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: t('Passwords do not match', 'كلمتا المرور غير متطابقتين'), variant: 'destructive' });
      return;
    }
    setUserPassword.mutate(
      { id: passwordTarget.id, data: { password: newPassword } },
      {
        onSuccess: () => {
          toast({ title: t('Password updated', 'تم تحديث كلمة المرور'), description: t(`Password set for ${passwordTarget.name}.`, `تم تعيين كلمة المرور لـ ${passwordTarget.name}.`) });
          closePasswordDialog();
        },
        onError: () => {
          toast({ title: t('Failed to set password', 'فشل تعيين كلمة المرور'), variant: 'destructive' });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('System Users', 'مستخدمي النظام')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage access, authentication, and user accounts.', 'إدارة الوصول والمصادقة وحسابات المستخدمين.')}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} data-testid="button-invite-user">
          <UserCog className="w-4 h-4 me-2" />
          {t('Invite User', 'دعوة مستخدم')}
        </Button>
      </div>

      <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-start gap-4">
        <div className="bg-background p-2 rounded shrink-0">
          <Server className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold text-primary mb-1">Keycloak / LDAP Integration Placeholder</h3>
          <p className="text-sm text-primary/80">
            {t('Connect your enterprise Identity Provider (IdP) for Single Sign-On (SSO) and automated provisioning.', 'قم بتوصيل مزود الهوية المؤسسي (IdP) لتسجيل الدخول الموحد (SSO) والإعداد التلقائي.')}
          </p>
          <Button variant="outline" size="sm" className="mt-3 bg-background border-primary/20">
            {t('Configure IdP', 'تكوين مزود الهوية')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="relative max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder={t('Search users...', 'البحث عن المستخدمين...')}
              className="ps-9"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>{t('User', 'المستخدم')}</TableHead>
                <TableHead>{t('Role', 'الدور')}</TableHead>
                <TableHead>{t('Security', 'الأمان')}</TableHead>
                <TableHead>{t('Last Login', 'آخر تسجيل دخول')}</TableHead>
                <TableHead className="text-end">{t('Action', 'الإجراء')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-8 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 ms-auto" /></TableCell>
                  </TableRow>
                ))
              ) : !usersData || usersData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {t('No users found.', 'لا يوجد مستخدمين.')}
                  </TableCell>
                </TableRow>
              ) : (
                usersData.map((user) => (
                  <TableRow
                    key={user.id}
                    ref={user.username === highlightUsername ? highlightRowRef : undefined}
                    data-testid={`row-user-${user.id}`}
                    className={user.username === highlightUsername ? 'bg-amber-500/10 hover:bg-amber-500/15' : undefined}
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {lang === 'en' ? user.fullNameEn : user.fullNameAr}
                        </span>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal bg-background">
                        {user.roleNameEn}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Badge variant={user.isActive ? 'default' : 'secondary'} className={user.isActive ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 shadow-none border-transparent" : "border-transparent shadow-none"}>
                          {user.isActive ? t('Active', 'نشط') : t('Inactive', 'غير نشط')}
                        </Badge>
                        {user.mfaEnabled && (
                          <Badge variant="outline" className="border-blue-500/30 text-blue-500 bg-blue-500/5 shadow-none" title="MFA Enabled">
                            <Shield className="w-3 h-3 me-1" /> MFA
                          </Badge>
                        )}
                        {isLocked(user.lockedUntil) && (
                          <Badge variant="outline" className="border-red-500/30 text-red-500 bg-red-500/5 shadow-none" title={t('Locked out after repeated failed logins', 'مقفل بعد محاولات تسجيل دخول فاشلة متكررة')}>
                            <Lock className="w-3 h-3 me-1" /> {t('Locked', 'مقفل')}
                          </Badge>
                        )}
                        {user.mustChangePassword && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 text-amber-600 dark:text-amber-500 bg-amber-500/5 shadow-none"
                            title={t('Holding a provisional credential — must set a new password at next login', 'يحمل بيانات اعتماد مؤقتة — يجب تعيين كلمة مرور جديدة عند تسجيل الدخول التالي')}
                            data-testid={`badge-must-change-password-${user.id}`}
                          >
                            <Hourglass className="w-3 h-3 me-1" /> {t('Must change password', 'يجب تغيير كلمة المرور')}
                          </Badge>
                        )}
                      </div>
                      {user.lastOtpIssuedAt && (
                        <p className="text-xs text-muted-foreground mt-1.5" data-testid={`text-last-otp-${user.id}`}>
                          {t('OTP issued', 'أُصدرت كلمة مرور لمرة واحدة')} {new Date(user.lastOtpIssuedAt).toLocaleString()}
                          {user.lastOtpIssuedByName ? ` ${t('by', 'بواسطة')} ${user.lastOtpIssuedByName}` : ''}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : t('Never', 'أبداً')}
                    </TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEditDialog(user)} data-testid={`menu-edit-user-${user.id}`}>
                            <Pencil className="w-4 h-4 me-2" />
                            {t('Edit User', 'تعديل المستخدم')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPasswordTarget({ id: user.id, name: lang === 'en' ? user.fullNameEn : user.fullNameAr })}>
                            <KeyRound className="w-4 h-4 me-2" />
                            {t('Set Password', 'تعيين كلمة المرور')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setOtpTarget({ id: user.id, name: lang === 'en' ? user.fullNameEn : user.fullNameAr })}>
                            <Ticket className="w-4 h-4 me-2" />
                            {t('Issue One-Time Password', 'إصدار كلمة مرور لمرة واحدة')}
                          </DropdownMenuItem>
                          {isLocked(user.lockedUntil) && (
                            <DropdownMenuItem
                              disabled={unlockUser.isPending}
                              onClick={() => handleUnlock(user.id, lang === 'en' ? user.fullNameEn : user.fullNameAr)}
                            >
                              <LockOpen className="w-4 h-4 me-2" />
                              {t('Unlock Account', 'إلغاء قفل الحساب')}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={(open) => { if (!open) closeInviteDialog(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Invite User', 'دعوة مستخدم')}</DialogTitle>
            <DialogDescription>
              {t('Create a new account. You will get a one-time password to hand to the person; they set their own password on first sign-in.', 'أنشئ حساباً جديداً. ستحصل على كلمة مرور لمرة واحدة لتسليمها للشخص؛ وسيعين كلمة مروره الخاصة عند أول تسجيل دخول.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-username">{t('Username', 'اسم المستخدم')}</Label>
              <Input id="invite-username" data-testid="input-invite-username" value={inviteUsername} onChange={(e) => setInviteUsername(e.target.value)} placeholder="maher" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('Email', 'البريد الإلكتروني')}</Label>
              <Input id="invite-email" data-testid="input-invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name-en">{t('Full name (English)', 'الاسم الكامل (الإنجليزية)')}</Label>
              <Input id="invite-name-en" data-testid="input-invite-name-en" value={inviteNameEn} onChange={(e) => setInviteNameEn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name-ar">{t('Full name (Arabic)', 'الاسم الكامل (العربية)')}</Label>
              <Input id="invite-name-ar" data-testid="input-invite-name-ar" dir="rtl" value={inviteNameAr} onChange={(e) => setInviteNameAr(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('Role', 'الدور')}</Label>
              <Select value={inviteRoleId} onValueChange={setInviteRoleId}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue placeholder={t('Choose a role', 'اختر دوراً')} />
                </SelectTrigger>
                <SelectContent>
                  {(rolesData ?? []).map((role) => (
                    <SelectItem key={role.id} value={String(role.id)} data-testid={`select-invite-role-${role.id}`}>
                      {lang === 'en' ? role.nameEn : role.nameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeInviteDialog} data-testid="button-invite-cancel">{t('Cancel', 'إلغاء')}</Button>
            <Button onClick={handleInvite} disabled={createUser.isPending} data-testid="button-invite-submit">
              {createUser.isPending ? t('Creating…', 'جارٍ الإنشاء…') : t('Create User', 'إنشاء مستخدم')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Edit User', 'تعديل المستخدم')}</DialogTitle>
            <DialogDescription>
              {editTarget && t(`Update account details for ${editTarget.name}. Changes take effect immediately.`, `تحديث بيانات الحساب لـ ${editTarget.name}. تسري التغييرات فوراً.`)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">{t('Email', 'البريد الإلكتروني')}</Label>
              <Input id="edit-email" type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} data-testid="input-edit-email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name-en">{t('Full Name (English)', 'الاسم الكامل (إنجليزي)')}</Label>
              <Input id="edit-name-en" value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name-ar">{t('Full Name (Arabic)', 'الاسم الكامل (عربي)')}</Label>
              <Input id="edit-name-ar" dir="rtl" value={editNameAr} onChange={(e) => setEditNameAr(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>{t('Cancel', 'إلغاء')}</Button>
            <Button onClick={handleSaveEdit} disabled={updateUser.isPending} data-testid="button-save-edit-user">
              {updateUser.isPending ? t('Saving...', 'جارٍ الحفظ...') : t('Save Changes', 'حفظ التغييرات')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={passwordTarget !== null} onOpenChange={(open) => { if (!open) closePasswordDialog(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Set Password', 'تعيين كلمة المرور')}</DialogTitle>
            <DialogDescription>
              {passwordTarget && t(`Set a new password for ${passwordTarget.name}. It is hashed on the server and never stored in plain text.`, `تعيين كلمة مرور جديدة لـ ${passwordTarget.name}. يتم تشفيرها على الخادم ولا تُخزن كنص عادي أبداً.`)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('New Password', 'كلمة المرور الجديدة')}</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('At least 8 characters', '8 أحرف على الأقل')}
              />
              <p className="text-xs text-muted-foreground">
                {t(PASSWORD_REQUIREMENTS_EN, PASSWORD_REQUIREMENTS_AR)}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t('Confirm Password', 'تأكيد كلمة المرور')}</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closePasswordDialog}>{t('Cancel', 'إلغاء')}</Button>
            <Button onClick={handleSetPassword} disabled={setUserPassword.isPending}>
              {setUserPassword.isPending ? t('Saving...', 'جارٍ الحفظ...') : t('Set Password', 'تعيين كلمة المرور')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={otpTarget !== null} onOpenChange={(open) => { if (!open) setOtpTarget(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('Issue One-Time Password', 'إصدار كلمة مرور لمرة واحدة')}</DialogTitle>
            <DialogDescription>
              {otpTarget && t(
                `Generate a random one-time password for ${otpTarget.name}. This replaces their current password, signs them out of all devices, and they must set a new password at first login. The password is shown exactly once.`,
                `إنشاء كلمة مرور عشوائية لمرة واحدة لـ ${otpTarget.name}. سيؤدي ذلك إلى استبدال كلمة المرور الحالية وتسجيل الخروج من جميع الأجهزة، ويجب تعيين كلمة مرور جديدة عند أول تسجيل دخول. تُعرض كلمة المرور مرة واحدة فقط.`,
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtpTarget(null)}>{t('Cancel', 'إلغاء')}</Button>
            <Button onClick={handleIssueOtp} disabled={issueOtp.isPending} data-testid="button-confirm-issue-otp">
              {issueOtp.isPending ? t('Issuing...', 'جارٍ الإصدار...') : t('Issue Password', 'إصدار كلمة المرور')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={issuedOtp !== null} onOpenChange={(open) => { if (!open) setIssuedOtp(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('One-Time Password Issued', 'تم إصدار كلمة المرور لمرة واحدة')}</DialogTitle>
            <DialogDescription>
              {issuedOtp && t(
                `Deliver this password to ${issuedOtp.name} (${issuedOtp.username}) through a secure channel. It will not be shown again — once you close this dialog, it cannot be retrieved. They must change it at first login.`,
                `سلّم كلمة المرور هذه إلى ${issuedOtp.name} (${issuedOtp.username}) عبر قناة آمنة. لن تُعرض مرة أخرى — بعد إغلاق هذه النافذة لا يمكن استعادتها. يجب تغييرها عند أول تسجيل دخول.`,
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all select-all" data-testid="text-one-time-password">
              {issuedOtp?.oneTimePassword}
            </code>
            <Button variant="outline" size="icon" onClick={copyOtp} title={t('Copy', 'نسخ')} data-testid="button-copy-otp">
              {otpCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssuedOtp(null)}>{t("Done — I've saved it", 'تم — لقد حفظتها')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
