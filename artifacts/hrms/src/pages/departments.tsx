import { useLanguage } from '@/hooks/use-language';
import { useListDepartments, useGetDepartmentTree, useCreateDepartment, useGetDepartment, useUpdateDepartment, useDeleteDepartment, getGetDepartmentQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Network, Plus, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Departments() {
  const { t, lang } = useLanguage();
  const { data: departments, isLoading } = useListDepartments();
  const { data: tree } = useGetDepartmentTree();
  const createDepartment = useCreateDepartment();
  const updateDepartment = useUpdateDepartment();
  const deleteDepartment = useDeleteDepartment();
  // Using a placeholder id for useGetDepartment so it satisfies the compiler
  const { data: deptDetails } = useGetDepartment(1, { query: { enabled: false, queryKey: getGetDepartmentQueryKey(1) } });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Organization Hierarchy', 'الهيكل التنظيمي')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage departments, divisions, and reporting lines.', 'إدارة الأقسام والقطاعات وخطوط التقارير.')}
          </p>
        </div>
        <Button>
          <Plus className="w-4 h-4 me-2" />
          {t('Add Department', 'إضافة قسم')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="w-5 h-5" />
            {t('Departments', 'الأقسام')}
          </CardTitle>
          <CardDescription>
            {t('Flat view of all organizational units.', 'عرض مسطح لجميع الوحدات التنظيمية.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Department Name', 'اسم القسم')}</TableHead>
                <TableHead>{t('Code', 'الرمز')}</TableHead>
                <TableHead>{t('Parent', 'القسم التابع له')}</TableHead>
                <TableHead>{t('Head', 'الرئيس')}</TableHead>
                <TableHead className="text-end">{t('Headcount', 'عدد الموظفين')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-12 ms-auto" /></TableCell>
                  </TableRow>
                ))
              ) : departments?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {t('No departments found.', 'لا توجد أقسام.')}
                  </TableCell>
                </TableRow>
              ) : (
                departments?.map((dept) => (
                  <TableRow key={dept.id}>
                    <TableCell className="font-medium">
                      {lang === 'en' ? dept.nameEn : dept.nameAr}
                      {dept.organizationType !== 'commercial' && (
                        <Badge variant="outline" className="ms-2 text-[10px] uppercase">
                          {dept.organizationType}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{dept.code}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{dept.parentNameEn || '-'}</TableCell>
                    <TableCell>{dept.headEmployeeNameEn || <span className="text-muted-foreground italic">{t('Vacant', 'شاغر')}</span>}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{dept.employeeCount}</span>
                      </div>
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
