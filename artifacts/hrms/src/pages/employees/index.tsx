import { useLanguage } from '@/hooks/use-language';
import { useListEmployees, useCreateEmployee } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Filter, Plus, FileDown, MoreHorizontal, User } from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';

import { AnimatedPage } from '@/components/layout/AnimatedPage';

export default function Employees() {
  const { t, lang } = useLanguage();
  const [search, setSearch] = useState('');
  
  const { data: employeesData, isLoading } = useListEmployees({
    search: search || undefined
  });
  
  const createEmployee = useCreateEmployee();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20">{t('Active', 'نشط')}</Badge>;
      case 'on_leave':
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20">{t('On Leave', 'في إجازة')}</Badge>;
      case 'terminated':
        return <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20">{t('Terminated', 'منهى خدمته')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Employee Directory', 'دليل الموظفين')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage personnel records, roles, and status.', 'إدارة سجلات الموظفين والأدوار والحالة.')}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none">
            <FileDown className="w-4 h-4 me-2" />
            {t('Export', 'تصدير')}
          </Button>
          <Button className="flex-1 sm:flex-none">
            <Plus className="w-4 h-4 me-2" />
            {t('Add Employee', 'إضافة موظف')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder={t('Search by name, ID, or email...', 'ابحث بالاسم أو الهوية أو البريد...')}
                className="ps-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" className="shrink-0">
              <Filter className="w-4 h-4 me-2" />
              {t('Filters', 'تصنيف')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[300px]">{t('Employee', 'الموظف')}</TableHead>
                <TableHead>{t('ID & Role', 'الهوية والدور')}</TableHead>
                <TableHead>{t('Department', 'القسم')}</TableHead>
                <TableHead>{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-end">{t('Actions', 'الإجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-10 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 ms-auto" /></TableCell>
                  </TableRow>
                ))
              ) : employeesData?.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    {t('No employees found.', 'لم يتم العثور على موظفين.')}
                  </TableCell>
                </TableRow>
              ) : (
                employeesData?.data.map((employee) => (
                  <TableRow key={employee.id} className="group cursor-pointer hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border border-border">
                          {employee.photoUrl ? (
                            <AvatarImage src={employee.photoUrl} alt={employee.firstNameEn} />
                          ) : (
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {employee.firstNameEn.charAt(0)}{employee.lastNameEn.charAt(0)}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div>
                          <Link href={`/employees/${employee.id}`} className="font-medium text-foreground hover:underline hover:text-primary transition-colors block">
                            {lang === 'en' ? `${employee.firstNameEn} ${employee.lastNameEn}` : `${employee.firstNameAr} ${employee.lastNameAr}`}
                          </Link>
                          <span className="text-xs text-muted-foreground">{employee.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm text-foreground">{employee.employeeNumber}</span>
                        <span className="text-xs text-muted-foreground">{lang === 'en' ? employee.jobTitleEn : employee.jobTitleAr}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm text-foreground">{lang === 'en' ? employee.departmentNameEn : employee.departmentNameAr}</span>
                        <span className="text-xs text-muted-foreground">{employee.organizationType}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(employee.status)}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          
          {!isLoading && employeesData && (
            <div className="p-4 border-t text-sm text-muted-foreground flex justify-between items-center">
              <span>
                {t(`Showing ${employeesData.data.length} of ${employeesData.total} employees`, `إظهار ${employeesData.data.length} من ${employeesData.total} موظف`)}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={employeesData.page === 1}>
                  {t('Previous', 'السابق')}
                </Button>
                <Button variant="outline" size="sm" disabled={employeesData.page * employeesData.limit >= employeesData.total}>
                  {t('Next', 'التالي')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AnimatedPage>
  );
}
