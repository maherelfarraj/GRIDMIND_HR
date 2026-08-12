import { useLanguage } from '@/hooks/use-language';
import { localName, localFullName } from '@/lib/localise';
import { useAuth } from '@/hooks/use-auth';
import { useListEmployees, useCreateEmployee, useListDepartments, useListRoles, getListEmployeesQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Search, Plus, FileDown, MoreHorizontal, CalendarX2 } from 'lucide-react';
import { Link } from 'wouter';
import { useState } from 'react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { useQueryClient } from '@tanstack/react-query';

type StatusFilter = 'all' | 'active' | 'on_leave' | 'terminated';

const EMPTY_FORM = {
  firstNameEn: '', lastNameEn: '',
  firstNameAr: '', lastNameAr: '',
  nationalId: '', email: '',
  employeeNumber: '',
  jobTitleEn: '', jobTitleAr: '',
  departmentId: '', roleId: '',
  hireDate: new Date().toISOString().slice(0, 10),
  status: 'active',
  employmentType: 'full_time',
  organizationType: 'commercial',
  nationality: 'JO',
};

export default function Employees() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user ? user.roleId <= 2 : false;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: employeesData, isLoading } = useListEmployees({
    search: search || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });
  const { data: departments } = useListDepartments();
  const { data: roles } = useListRoles();
  const createEmployee = useCreateEmployee();

  const set = (key: keyof typeof EMPTY_FORM, value: string) =>
    setForm(p => ({ ...p, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await createEmployee.mutateAsync({
        data: {
          firstNameEn: form.firstNameEn,
          lastNameEn: form.lastNameEn,
          firstNameAr: form.firstNameAr,
          lastNameAr: form.lastNameAr,
          nationalId: form.nationalId,
          email: form.email,
          employeeNumber: form.employeeNumber || `EMP-${Date.now()}`,
          jobTitleEn: form.jobTitleEn,
          jobTitleAr: form.jobTitleAr,
          departmentId: Number(form.departmentId),
          roleId: Number(form.roleId),
          hireDate: form.hireDate,
          status: form.status,
          employmentType: form.employmentType,
          organizationType: form.organizationType,
          nationality: form.nationality,
        },
      });
      qc.invalidateQueries({ queryKey: getListEmployeesQueryKey() });
      setSheetOpen(false);
      setForm(EMPTY_FORM);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create employee';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">{t('Active', 'نشط')}</Badge>;
      case 'on_leave': return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20">{t('On Leave', 'في إجازة')}</Badge>;
      case 'terminated': return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20">{t('Terminated', 'منهى خدمته')}</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <AnimatedPage className="space-y-6">
      {/* Add Employee Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t('Add Employee', 'إضافة موظف')}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('Name', 'الاسم')}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('First Name (EN)', 'الاسم الأول (إنجليزي)')} *</Label>
                <Input value={form.firstNameEn} onChange={e => set('firstNameEn', e.target.value)} required placeholder="Maher" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Last Name (EN)', 'الاسم الأخير (إنجليزي)')} *</Label>
                <Input value={form.lastNameEn} onChange={e => set('lastNameEn', e.target.value)} required placeholder="Elfarraj" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('First Name (AR)', 'الاسم الأول (عربي)')} *</Label>
                <Input value={form.firstNameAr} onChange={e => set('firstNameAr', e.target.value)} required placeholder="ماهر" dir="rtl" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Last Name (AR)', 'الاسم الأخير (عربي)')} *</Label>
                <Input value={form.lastNameAr} onChange={e => set('lastNameAr', e.target.value)} required placeholder="الفراج" dir="rtl" />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">{t('Contact & Identity', 'جهة الاتصال والهوية')}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('Email', 'البريد الإلكتروني')} *</Label>
                <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} required placeholder="m.elfarraj@gsi.jo" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('National ID', 'رقم الهوية')} *</Label>
                <Input value={form.nationalId} onChange={e => set('nationalId', e.target.value)} required placeholder="1234567890" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Nationality', 'الجنسية')} *</Label>
                <Input value={form.nationality} onChange={e => set('nationality', e.target.value)} required placeholder="JO" maxLength={2} />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Hire Date', 'تاريخ التعيين')} *</Label>
                <Input type="date" value={form.hireDate} onChange={e => set('hireDate', e.target.value)} required />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">{t('Position', 'المنصب')}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('Job Title (EN)', 'المسمى الوظيفي (إنجليزي)')} *</Label>
                <Input value={form.jobTitleEn} onChange={e => set('jobTitleEn', e.target.value)} required placeholder="HR Manager" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Job Title (AR)', 'المسمى الوظيفي (عربي)')} *</Label>
                <Input value={form.jobTitleAr} onChange={e => set('jobTitleAr', e.target.value)} required placeholder="مدير الموارد البشرية" dir="rtl" />
              </div>
              <div className="space-y-1.5">
                <Label>{t('Department', 'القسم')} *</Label>
                <Select value={form.departmentId} onValueChange={v => set('departmentId', v)} required>
                  <SelectTrigger><SelectValue placeholder={t('Select…', 'اختر…')} /></SelectTrigger>
                  <SelectContent>
                    {departments?.map(d => <SelectItem key={d.id} value={String(d.id)}>{localName(d.nameEn, d.nameAr, lang)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('Role', 'الدور')} *</Label>
                <Select value={form.roleId} onValueChange={v => set('roleId', v)} required>
                  <SelectTrigger><SelectValue placeholder={t('Select…', 'اختر…')} /></SelectTrigger>
                  <SelectContent>
                    {roles?.map(r => <SelectItem key={r.id} value={String(r.id)}>{localName(r.nameEn, r.nameAr, lang)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">{t('Classification', 'التصنيف')}</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>{t('Status', 'الحالة')}</Label>
                <Select value={form.status} onValueChange={v => set('status', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t('Active', 'نشط')}</SelectItem>
                    <SelectItem value="on_leave">{t('On Leave', 'في إجازة')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('Employment Type', 'نوع التعاقد')}</Label>
                <Select value={form.employmentType} onValueChange={v => set('employmentType', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_time">{t('Full Time', 'دوام كامل')}</SelectItem>
                    <SelectItem value="part_time">{t('Part Time', 'دوام جزئي')}</SelectItem>
                    <SelectItem value="contract">{t('Contract', 'عقد')}</SelectItem>
                    <SelectItem value="temporary">{t('Temporary', 'مؤقت')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('Org Type', 'نوع المنظمة')}</Label>
                <Select value={form.organizationType} onValueChange={v => set('organizationType', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commercial">{t('Commercial', 'تجاري')}</SelectItem>
                    <SelectItem value="government">{t('Government', 'حكومي')}</SelectItem>
                    <SelectItem value="military">{t('Military', 'عسكري')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formError && <p className="text-sm text-destructive bg-destructive/10 rounded p-2">{formError}</p>}

            <SheetFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('Saving…', 'جارٍ الحفظ…') : t('Add Employee', 'إضافة موظف')}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Employee Directory', 'دليل الموظفين')}</h1>
          <p className="text-muted-foreground mt-1">{t('Manage personnel records, roles, and status.', 'إدارة سجلات الموظفين والأدوار والحالة.')}</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" className="flex-1 sm:flex-none">
            <FileDown className="w-4 h-4 me-2" />{t('Export', 'تصدير')}
          </Button>
          <Button className="flex-1 sm:flex-none" onClick={() => setSheetOpen(true)}>
            <Plus className="w-4 h-4 me-2" />{t('Add Employee', 'إضافة موظف')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder={t('Search by name, ID, or email...', 'ابحث بالاسم أو الهوية أو البريد...')} className="ps-9" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-full sm:w-44 shrink-0"><SelectValue placeholder={t('Filter by status', 'تصنيف حسب الحالة')} /></SelectTrigger>
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
                {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }).map((_, j) => <TableCell key={j}><Skeleton className="h-10 w-full" /></TableCell>)}
                  </TableRow>
                )) : employeesData?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                      {t('No employees found. Click "Add Employee" to get started.', 'لم يتم العثور على موظفين. انقر على "إضافة موظف" للبدء.')}
                    </TableCell>
                  </TableRow>
                ) : employeesData?.data.map(employee => (
                  <TableRow key={employee.id} className="group cursor-pointer hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border border-border">
                          {employee.photoUrl ? (
                            <AvatarImage src={employee.photoUrl} alt={employee.firstNameEn} />
                          ) : (
                            <AvatarFallback className="bg-primary/10 text-primary">
                              {localFullName(employee.firstNameEn, employee.lastNameEn, employee.firstNameAr, employee.lastNameAr, lang).split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('')}
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
                        <span className="font-medium text-sm">{employee.employeeNumber}</span>
                        <span className="text-xs text-muted-foreground">{localName(employee.jobTitleEn, employee.jobTitleAr, lang)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{localName(employee.departmentNameEn ?? '', employee.departmentNameAr ?? '', lang)}</span>
                        <span className="text-xs text-muted-foreground">{employee.organizationType}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {getStatusBadge(employee.status)}
                        {employee.terminationDate && (
                          <span className="flex items-center gap-1 text-xs text-destructive/80 mt-0.5">
                            <CalendarX2 className="w-3 h-3 shrink-0" />
                            {t(`Leaving ${formatDate(employee.terminationDate)}`, `مغادرة ${formatDate(employee.terminationDate)}`)}
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
                ))}
              </TableBody>
            </Table>
          </div>
          {!isLoading && employeesData && (
            <div className="p-4 border-t text-sm text-muted-foreground flex justify-between items-center">
              <span>{t(`Showing ${employeesData.data.length} of ${employeesData.total} employees`, `إظهار ${employeesData.data.length} من ${employeesData.total} موظف`)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={employeesData.page === 1}>{t('Previous', 'السابق')}</Button>
                <Button variant="outline" size="sm" disabled={employeesData.page * employeesData.limit >= employeesData.total}>{t('Next', 'التالي')}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </AnimatedPage>
  );
}
