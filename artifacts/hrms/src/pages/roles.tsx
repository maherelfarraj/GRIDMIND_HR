import { useLanguage } from '@/hooks/use-language';
import { useListRoles, useCreateRole, useGetRole, useUpdateRole, useDeleteRole, useListPermissions, getGetRoleQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, Plus, Users, Lock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Roles() {
  const { t, lang } = useLanguage();
  const { data: roles, isLoading } = useListRoles();
  const { data: permissions } = useListPermissions();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const { data: roleDetail } = useGetRole(1, { query: { enabled: false, queryKey: getGetRoleQueryKey(1) } });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Roles & Permissions', 'الأدوار والصلاحيات')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage access control and operational capabilities.', 'إدارة التحكم في الوصول والقدرات التشغيلية.')}
          </p>
        </div>
        <Button>
          <Plus className="w-4 h-4 me-2" />
          {t('Create Role', 'إنشاء دور')}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))
        ) : roles?.map((role) => (
          <Card key={role.id} className="flex flex-col">
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-xl">
                  {lang === 'en' ? role.nameEn : role.nameAr}
                </CardTitle>
                {role.systemRole && (
                  <Badge variant="secondary" className="flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    {t('System', 'نظام')}
                  </Badge>
                )}
              </div>
              {role.description && (
                <CardDescription className="line-clamp-2">
                  {role.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between">
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium mb-2">{t('Permissions', 'الصلاحيات')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {role.permissions.slice(0, 5).map(p => (
                      <Badge key={p} variant="outline" className="text-xs bg-muted/50 font-normal">
                        {p}
                      </Badge>
                    ))}
                    {role.permissions.length > 5 && (
                      <Badge variant="outline" className="text-xs bg-muted/50 font-normal">
                        +{role.permissions.length - 5} {t('more', 'المزيد')}
                      </Badge>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-4 border-t mt-4 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="w-4 h-4" />
                    <span>{role.userCount} {t('Assigned', 'معين')}</span>
                  </div>
                  <Button variant="link" size="sm" className="px-0 h-auto">
                    {t('Edit Role', 'تعديل الدور')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
