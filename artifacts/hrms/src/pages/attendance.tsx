import { useLanguage } from '@/hooks/use-language';
import { useListAttendance, useGetAttendanceDailySummary } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Calendar, Download, Filter } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Attendance() {
  const { t, lang } = useLanguage();
  const { data: attendanceData, isLoading: loadingAttendance } = useListAttendance();
  const { data: summaryData, isLoading: loadingSummary } = useGetAttendanceDailySummary();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'present':
        return <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-transparent shadow-none">{t('Present', 'حاضر')}</Badge>;
      case 'absent':
        return <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-transparent shadow-none">{t('Absent', 'غائب')}</Badge>;
      case 'late':
        return <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-transparent shadow-none">{t('Late', 'متأخر')}</Badge>;
      case 'on_leave':
        return <Badge variant="secondary" className="border-transparent shadow-none">{t('Leave', 'إجازة')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const summary = summaryData ? summaryData.reduce((acc, curr) => ({
    present: acc.present + curr.present,
    absent: acc.absent + curr.absent,
    late: acc.late + curr.late,
    attendanceRate: Math.round(((acc.present + curr.present) / ((acc.present + curr.present) + (acc.absent + curr.absent))) * 100) || 0
  }), { present: 0, absent: 0, late: 0, attendanceRate: 0 }) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Attendance & Time', 'الحضور والانصراف')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Daily workforce availability and shift tracking.', 'توافر القوى العاملة اليومية وتتبع الورديات.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Download className="w-4 h-4 me-2" />
            {t('Export Report', 'تصدير التقرير')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {loadingSummary ? (
           Array.from({ length: 4 }).map((_, i) => (
             <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
           ))
        ) : summary ? (
          <>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground">{t('Total Present', 'إجمالي الحاضرين')}</p>
                <p className="text-3xl font-bold mt-2 text-emerald-500">{summary.present}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground">{t('Absent', 'الغائبون')}</p>
                <p className="text-3xl font-bold mt-2 text-destructive">{summary.absent}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground">{t('Late', 'المتأخرون')}</p>
                <p className="text-3xl font-bold mt-2 text-amber-500">{summary.late}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground">{t('Attendance Rate', 'معدل الحضور')}</p>
                <p className="text-3xl font-bold mt-2">{summary.attendanceRate}%</p>
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      <Card>
        <CardHeader className="py-4 border-b flex flex-row items-center justify-between">
          <div className="flex gap-4 flex-1">
            <Button variant="outline" className="justify-start text-start font-normal w-[240px]">
              <Calendar className="me-2 h-4 w-4" />
              <span>{new Date().toLocaleDateString()}</span>
            </Button>
            <Button variant="outline" className="shrink-0">
              <Filter className="w-4 h-4 me-2" />
              {t('Filter by Department', 'تصفية حسب القسم')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>{t('Employee', 'الموظف')}</TableHead>
                <TableHead>{t('Department', 'القسم')}</TableHead>
                <TableHead>{t('Check In', 'دخول')}</TableHead>
                <TableHead>{t('Check Out', 'خروج')}</TableHead>
                <TableHead>{t('Status', 'الحالة')}</TableHead>
                <TableHead className="text-end">{t('Device', 'الجهاز')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
               {loadingAttendance ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24 ms-auto" /></TableCell>
                  </TableRow>
                ))
              ) : !attendanceData || attendanceData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t('No attendance records found.', 'لم يتم العثور على سجلات.')}
                  </TableCell>
                </TableRow>
              ) : (
                attendanceData.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-medium">
                      {lang === 'en' ? record.employeeNameEn : record.employeeNameAr}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{record.departmentNameEn}</TableCell>
                    <TableCell className="font-mono text-xs">{record.checkInTime || '--:--'}</TableCell>
                    <TableCell className="font-mono text-xs">{record.checkOutTime || '--:--'}</TableCell>
                    <TableCell>{getStatusBadge(record.status)}</TableCell>
                    <TableCell className="text-end text-muted-foreground text-xs">{record.deviceName || '-'}</TableCell>
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
