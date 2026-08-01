import { useLanguage } from '@/hooks/use-language';
import { useGetEmployee, useGetEmployeeAttendance, useGetEmployeeDocuments, useUpdateEmployee, useDeleteEmployee } from '@workspace/api-client-react';
import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Edit, Mail, Phone, MapPin, Calendar, Briefcase, FileText, Clock, User, Shield, Plus, LogOut } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';

import { AnimatedPage } from '@/components/layout/AnimatedPage';

export default function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useLanguage();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [offboardOpen, setOffboardOpen] = useState(false);
  const [lastWorkingDay, setLastWorkingDay] = useState('');
  
  const { data: employee, isLoading } = useGetEmployee(Number(id));
  const { data: documents } = useGetEmployeeDocuments(Number(id));
  const { data: attendance } = useGetEmployeeAttendance(Number(id), {});

  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex gap-4 items-center">
          <Skeleton className="w-10 h-10 rounded-full" />
          <Skeleton className="w-48 h-8" />
        </div>
        <Skeleton className="w-full h-[400px]" />
      </div>
    );
  }

  if (!employee) {
    return <div>{t('Employee not found', 'لم يتم العثور على الموظف')}</div>;
  }

  const saveTermination = (date: string | null) => {
    updateEmployee.mutate(
      { id: Number(id), data: { terminationDate: date } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: [`/api/employees/${id}`] });
          queryClient.invalidateQueries({ queryKey: ['/api/employees'] });
          setOffboardOpen(false);
          toast({
            title: date
              ? t('Last working day recorded', 'تم تسجيل آخر يوم عمل')
              : t('Employee reinstated', 'تمت إعادة تعيين الموظف'),
          });
        },
        onError: (err: unknown) => {
          toast({
            title: t('Failed to update', 'فشل التحديث'),
            description: err instanceof Error ? err.message : undefined,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const name = lang === 'en' ? `${employee.firstNameEn} ${employee.lastNameEn}` : `${employee.firstNameAr} ${employee.lastNameAr}`;
  const title = lang === 'en' ? employee.jobTitleEn : employee.jobTitleAr;
  const dept = lang === 'en' ? employee.departmentNameEn : employee.departmentNameAr;

  return (
    <AnimatedPage className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Link href="/employees">
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className={`w-5 h-5 ${lang === 'ar' ? 'rotate-180' : ''}`} />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{name}</h1>
          <p className="text-muted-foreground">{employee.employeeNumber} • {title}</p>
        </div>
        <Button>
          <Edit className="w-4 h-4 me-2" />
          {t('Edit Profile', 'تعديل الملف')}
        </Button>
        <Dialog open={offboardOpen} onOpenChange={(open) => { setOffboardOpen(open); if (open) setLastWorkingDay(employee.terminationDate ?? ''); }}>
          <DialogTrigger asChild>
            <Button variant={employee.terminationDate ? 'outline' : 'destructive'} data-testid="button-offboard">
              <LogOut className="w-4 h-4 me-2" />
              {employee.terminationDate ? t('Update Last Working Day', 'تحديث آخر يوم عمل') : t('Offboard', 'إنهاء الخدمة')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('Record Last Working Day', 'تسجيل آخر يوم عمل')}</DialogTitle>
              <DialogDescription>
                {t(
                  'Set the employee\'s last working day. Payroll pays them up to and including this date; once the date has passed, the employee is marked as terminated.',
                  'حدد آخر يوم عمل للموظف. تدفع الرواتب حتى هذا التاريخ؛ وبعد مروره يتم تعيين حالة الموظف إلى منتهي الخدمة.'
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="last-working-day">{t('Last working day', 'آخر يوم عمل')}</Label>
              <Input
                id="last-working-day"
                type="date"
                value={lastWorkingDay}
                onChange={(e) => setLastWorkingDay(e.target.value)}
                data-testid="input-last-working-day"
              />
            </div>
            <DialogFooter className="gap-2">
              {employee.terminationDate && (
                <Button
                  variant="outline"
                  disabled={updateEmployee.isPending}
                  onClick={() => saveTermination(null)}
                  data-testid="button-clear-termination"
                >
                  {t('Clear & Reinstate', 'إلغاء وإعادة التعيين')}
                </Button>
              )}
              <Button
                disabled={!lastWorkingDay || updateEmployee.isPending}
                onClick={() => saveTermination(lastWorkingDay)}
                data-testid="button-save-termination"
              >
                {t('Save', 'حفظ')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardContent className="pt-6 flex flex-col items-center text-center">
              <Avatar className="w-32 h-32 border-4 border-background shadow-lg mb-4">
                {employee.photoUrl ? (
                  <AvatarImage src={employee.photoUrl} alt={name} />
                ) : (
                  <AvatarFallback className="text-4xl bg-primary/10 text-primary">
                    {employee.firstNameEn.charAt(0)}{employee.lastNameEn.charAt(0)}
                  </AvatarFallback>
                )}
              </Avatar>
              <h2 className="text-xl font-bold">{name}</h2>
              <p className="text-primary font-medium">{title}</p>
              
              <div className="flex gap-2 mt-4">
                <Badge variant={employee.status === 'active' ? 'default' : 'secondary'}>
                  {employee.status}
                </Badge>
                <Badge variant="outline">{employee.employmentType}</Badge>
              </div>

              <div className="w-full mt-6 space-y-3 text-start">
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{employee.email}</span>
                </div>
                {employee.phone && (
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span>{employee.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 text-sm">
                  <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{dept}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{employee.nationality}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{t('Hired', 'تاريخ التعيين')}: {new Date(employee.hireDate).toLocaleDateString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4" />
                {t('Security & Roles', 'الأمن والأدوار')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('Role', 'الدور')}</p>
                <p className="text-sm font-medium">{employee.roleNameEn}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t('Organization Type', 'نوع المنظمة')}</p>
                <p className="text-sm font-medium">{employee.organizationType}</p>
              </div>
              {employee.rankEn && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">{t('Rank', 'الرتبة')}</p>
                  <p className="text-sm font-medium">{lang === 'en' ? employee.rankEn : employee.rankAr}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">{t('Overview', 'نظرة عامة')}</TabsTrigger>
              <TabsTrigger value="documents">{t('Documents', 'المستندات')}</TabsTrigger>
              <TabsTrigger value="attendance">{t('Attendance', 'الحضور')}</TabsTrigger>
              <TabsTrigger value="approvals">{t('Approvals', 'الموافقات')}</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('Professional Details', 'التفاصيل المهنية')}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-y-6 gap-x-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('Employee Number', 'الرقم الوظيفي')}</p>
                    <p className="font-medium">{employee.employeeNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('National ID', 'الهوية الوطنية')}</p>
                    <p className="font-medium">{employee.nationalId}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('Manager', 'المدير المباشر')}</p>
                    <p className="font-medium">{employee.managerNameEn || t('None', 'لا يوجد')}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('Grade', 'الدرجة')}</p>
                    <p className="font-medium">{employee.grade || '-'}</p>
                  </div>
                  {employee.contractEndDate && (
                    <div>
                      <p className="text-sm text-muted-foreground">{t('Contract End', 'نهاية العقد')}</p>
                      <p className="font-medium">{new Date(employee.contractEndDate).toLocaleDateString()}</p>
                    </div>
                  )}
                  {employee.terminationDate && (
                    <div>
                      <p className="text-sm text-muted-foreground">{t('Last Working Day', 'آخر يوم عمل')}</p>
                      <p className="font-medium text-destructive" data-testid="text-termination-date">{new Date(employee.terminationDate).toLocaleDateString()}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>{t('Personnel File', 'ملف الموظف')}</CardTitle>
                    <CardDescription>{t('Official documents and records', 'المستندات والسجلات الرسمية')}</CardDescription>
                  </div>
                  <Button size="sm">
                    <Plus className="w-4 h-4 me-2" />
                    {t('Upload', 'رفع')}
                  </Button>
                </CardHeader>
                <CardContent>
                  {documents && documents.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('Title', 'العنوان')}</TableHead>
                          <TableHead>{t('Category', 'الفئة')}</TableHead>
                          <TableHead>{t('Status', 'الحالة')}</TableHead>
                          <TableHead>{t('Expiry', 'تاريخ الانتهاء')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {documents.map((doc) => (
                          <TableRow key={doc.id}>
                            <TableCell className="font-medium flex items-center gap-2">
                              <FileText className="w-4 h-4 text-muted-foreground" />
                              {lang === 'en' ? doc.titleEn : doc.titleAr}
                            </TableCell>
                            <TableCell><Badge variant="outline">{doc.category}</Badge></TableCell>
                            <TableCell>
                              <Badge variant={doc.status === 'active' ? 'default' : doc.status === 'expired' ? 'destructive' : 'secondary'}>
                                {doc.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString() : '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      {t('No documents found.', 'لم يتم العثور على مستندات.')}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="attendance" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('Recent Attendance', 'الحضور الأخير')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {attendance && attendance.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('Date', 'التاريخ')}</TableHead>
                          <TableHead>{t('Check In', 'تسجيل الدخول')}</TableHead>
                          <TableHead>{t('Check Out', 'تسجيل الخروج')}</TableHead>
                          <TableHead>{t('Status', 'الحالة')}</TableHead>
                          <TableHead>{t('Hours', 'الساعات')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendance.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell>{new Date(record.date).toLocaleDateString()}</TableCell>
                            <TableCell>{record.checkInTime || '-'}</TableCell>
                            <TableCell>{record.checkOutTime || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={record.status === 'present' ? 'default' : record.status === 'absent' ? 'destructive' : 'outline'}>
                                {record.status}
                              </Badge>
                            </TableCell>
                            <TableCell>{record.workingHours ? `${record.workingHours}h` : '-'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      {t('No attendance records found.', 'لم يتم العثور على سجلات حضور.')}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="approvals" className="mt-4">
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  {t('No pending approvals.', 'لا توجد موافقات معلقة.')}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AnimatedPage>
  );
}
