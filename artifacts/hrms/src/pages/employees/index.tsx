import { useLanguage } from '@/hooks/use-language';
import { localName, localFullName } from '@/lib/localise';
import { useAuth } from '@/hooks/use-auth';
import { useListEmployees, useCreateEmployee } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, FileDown, MoreHorizontal, CalendarX2 } from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';

import { AnimatedPage } from '@/components/layout/AnimatedPage';

type StatusFilter = 'all' | 'active' | 'on_leave' | 'terminated';

export default function Employees() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  // TODO: replace with proper role-name lookup once role names are exposed by useAuth
  // Role IDs: 1=super_admin, 2=hr_manager, 3=payroll_admin, 4=supervisor, 5=employee
  const isAdmin = user ? user.roleId <= 2 : false; // admin/hr_manager only
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: employeesData, isLoading } = useListEmployees({
    search: search || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
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

  const formatTerminationDate = (dateStr: string) => {
    const date = new Date(dateStr);
    // Use locale-aware formatting
    return date.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
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
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-44 shrink-0">
                <SelectValue placeholder={t('Filter by status', 'تصنيف حسب الحالة')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All employees', 'جميع الموظفين')}</SelectItem>
                <SelectItem value="active">{t('Active', 'نشط')}</SelectItem>
                <SelectItem value="on_leave">{t('On leave', 'في إجازة')}</SelectItem>
                <SelectItem value="terminated">{t('Leavers', 'المغادرون')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                              {localFullName(employee.firstNameEn, employee.lastNameEn, employee.firstNameAr, employee.lastNameAr, lang).split(' ').map(n => n[0]).filter(Boolean).slice(0,2).join('')}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div>
                          <Link href={`/employees/${employee.id}`} className="font-medium text-foreground hover:underline hover:text-primary transition-colors block">
                            {localFullName(employee.firstNameEn, employee.lastNameEn, employee.firstNameAr, employee.lastNameAr, lang)}
                          </Link>
                          <span className="text-xs text-muted-foreground">{employee.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm text-foreground">{employee.employeeNumber}</span>
                        <span className="text-xs text-muted-foreground">{localName(employee.jobTitleEn, employee.jobTitleAr, lang)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm text-foreground">{localName(employee.departmentNameEn, employee.departmentNameAr, lang)}</span>
                        <span className="text-xs text-muted-foreground">{employee.organizationType}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {getStatusBadge(employee.status)}
                        {employee.terminationDate && (
                          <span className="flex items-center gap-1 text-xs text-destructive/80 mt-0.5">
                            <CalendarX2 className="w-3 h-3 shrink-0" />
                            {t(
                              `Leaving ${formatTerminationDate(employee.terminationDate)}`,
                              `مغادرة ${formatTerminationDate(employee.terminationDate)}`
                            )}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-end">
                      {isAdmin && (
                        <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          </div>
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
