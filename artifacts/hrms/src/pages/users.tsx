import { useLanguage } from '@/hooks/use-language';
import { useListUsers, useCreateUser, useGetUser, useUpdateUser, getGetUserQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Server, Search, Shield, UserCog, MoreHorizontal } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Users() {
  const { t, lang } = useLanguage();
  const { data: usersData, isLoading } = useListUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const { data: userDetail } = useGetUser(1, { query: { enabled: false, queryKey: getGetUserQueryKey(1) } });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('System Users', 'مستخدمي النظام')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage access, authentication, and user accounts.', 'إدارة الوصول والمصادقة وحسابات المستخدمين.')}
          </p>
        </div>
        <Button>
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
                  <TableRow key={user.id}>
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
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : t('Never', 'أبداً')}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
