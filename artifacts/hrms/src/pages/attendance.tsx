import { apiFetch } from '@/lib/api';
import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useListAttendance, useGetAttendanceDailySummary, useListDevices, useListEmployees } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Calendar, Download, Filter, Clock, Fingerprint, Cpu, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';

interface DeviceMapping {
  deviceId: number;
  employeeId: number;
  employeeNameEn: string;
  employeeNameAr: string;
  employeeNumber: string;
  biometricType: string;
  accessLevel: string;
  enrolledAt: string;
  isActive: boolean;
  notes: string | null;
}

interface Correction {
  id: number;
  attendanceId: number;
  employeeId: number;
  employeeNameEn: string;
  employeeNameAr: string;
  correctionType: string;
  originalValue: string;
  requestedValue: string;
  reason: string;
  status: string;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: number | null;
  reviewedByUsername: string | null;
  reviewNote: string | null;
}

export default function Attendance() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date] = useState(new Date().toISOString().split('T')[0]);
  
  const { data: attendanceData, isLoading: loadingAttendance } = useListAttendance();
  const { data: summaryData, isLoading: loadingSummary } = useGetAttendanceDailySummary();
  const { data: devices } = useListDevices();
  const { data: employees } = useListEmployees();

  const [correctionDialog, setCorrectionDialog] = useState(false);
  const [selectedAttendance, setSelectedAttendance] = useState<any>(null);
  const [correctionType, setCorrectionType] = useState('');
  const [requestedValue, setRequestedValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [submittingCorrection, setSubmittingCorrection] = useState(false);

  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [deviceMappings, setDeviceMappings] = useState<DeviceMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [enrollDialog, setEnrollDialog] = useState(false);
  const [enrollEmployeeId, setEnrollEmployeeId] = useState('');
  const [enrollAccessLevel, setEnrollAccessLevel] = useState('standard');
  const [enrollBiometricType, setEnrollBiometricType] = useState('fingerprint');
  const [enrolling, setEnrolling] = useState(false);

  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loadingCorrections, setLoadingCorrections] = useState(false);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);

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

  const openCorrectionDialog = (record: any) => {
    setSelectedAttendance(record);
    setCorrectionType('');
    setRequestedValue('');
    setCorrectionReason('');
    setCorrectionDialog(true);
  };

  const submitCorrection = async () => {
    if (!selectedAttendance || !correctionType || !requestedValue || !correctionReason) return;
    
    setSubmittingCorrection(true);
    try {
      const res = await apiFetch(`/api/attendance/${selectedAttendance.id}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          employeeId: selectedAttendance.employeeId,
          correctionType,
          originalValue: correctionType === 'check_in' ? selectedAttendance.checkInTime : 
                          correctionType === 'check_out' ? selectedAttendance.checkOutTime : selectedAttendance.status,
          requestedValue,
          reason: correctionReason,
        }),
      });

      if (!res.ok) throw new Error('Failed to submit correction');
      
      toast({ title: t('Success', 'نجاح'), description: t('Correction request submitted', 'تم إرسال طلب التصحيح') });
      setCorrectionDialog(false);
      queryClient.invalidateQueries({ queryKey: ['listAttendance'] });
    } catch (error: any) {
      toast({ title: t('Error', 'خطأ'), description: error.message, variant: 'destructive' });
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const fetchDeviceMappings = async (deviceId: number) => {
    setLoadingMappings(true);
    try {
      const res = await apiFetch(`/api/device-mappings?deviceId=${deviceId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch mappings');
      const data = await res.json();
      setDeviceMappings(data);
    } catch (error) {
      toast({ title: t('Error', 'خطأ'), description: 'Failed to load device mappings', variant: 'destructive' });
    } finally {
      setLoadingMappings(false);
    }
  };

  const handleDeviceSelect = (deviceId: number) => {
    setSelectedDevice(deviceId);
    fetchDeviceMappings(deviceId);
  };

  const enrollEmployee = async () => {
    if (!selectedDevice || !enrollEmployeeId) return;
    
    setEnrolling(true);
    try {
      const res = await apiFetch(`/api/devices/${selectedDevice}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          employeeId: Number(enrollEmployeeId),
          accessLevel: enrollAccessLevel,
          biometricType: enrollBiometricType,
          enrolledAt: new Date().toISOString(),
          notes: null,
        }),
      });

      if (!res.ok) throw new Error('Failed to enroll employee');
      
      toast({ title: t('Success', 'نجاح'), description: t('Employee enrolled successfully', 'تم تسجيل الموظف بنجاح') });
      setEnrollDialog(false);
      setEnrollEmployeeId('');
      fetchDeviceMappings(selectedDevice);
    } catch (error: any) {
      toast({ title: t('Error', 'خطأ'), description: error.message, variant: 'destructive' });
    } finally {
      setEnrolling(false);
    }
  };

  const removeMapping = async (deviceId: number, employeeId: number) => {
    try {
      const res = await apiFetch(`/api/devices/${deviceId}/mappings/${employeeId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Failed to remove mapping');
      
      toast({ title: t('Success', 'نجاح'), description: t('Employee removed from device', 'تم إزالة الموظف من الجهاز') });
      fetchDeviceMappings(deviceId);
    } catch (error: any) {
      toast({ title: t('Error', 'خطأ'), description: error.message, variant: 'destructive' });
    }
  };

  const fetchCorrections = async (status?: string) => {
    setLoadingCorrections(true);
    try {
      const url = status ? `/api/attendance/corrections?status=${status}` : '/api/attendance/corrections';
      const res = await apiFetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch corrections');
      const data = await res.json();
      setCorrections(data);
    } catch (error) {
      toast({ title: t('Error', 'خطأ'), description: 'Failed to load corrections', variant: 'destructive' });
    } finally {
      setLoadingCorrections(false);
    }
  };

  const decideCorrection = async (id: number, decision: 'approved' | 'rejected', note?: string) => {
    setDecidingId(id);
    try {
      const res = await apiFetch(`/api/attendance/corrections/${id}/decision`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ decision, reviewNote: note }),
      });

      if (!res.ok) throw new Error('Failed to decide correction');
      
      toast({ 
        title: t('Success', 'نجاح'), 
        description: decision === 'approved' 
          ? t('Correction approved', 'تمت الموافقة على التصحيح') 
          : t('Correction rejected', 'تم رفض التصحيح')
      });
      fetchCorrections();
      setRejectDialogId(null);
      setRejectNote('');
    } catch (error: any) {
      toast({ title: t('Error', 'خطأ'), description: error.message, variant: 'destructive' });
    } finally {
      setDecidingId(null);
    }
  };

  const pendingCorrections = corrections.filter(c => c.status === 'pending');
  const approvedCorrections = corrections.filter(c => c.status === 'approved');
  const rejectedCorrections = corrections.filter(c => c.status === 'rejected');

  return (
    <AnimatedPage className="space-y-6">
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

      <Tabs defaultValue="daily" className="w-full" onValueChange={(val) => {
        if (val === 'corrections') fetchCorrections();
      }}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="daily">{t('Daily Log', 'السجل اليومي')}</TabsTrigger>
          <TabsTrigger value="events">{t('Punch Events', 'أحداث البصمة')}</TabsTrigger>
          <TabsTrigger value="corrections">{t('Corrections', 'تصحيحات')}</TabsTrigger>
          <TabsTrigger value="devices">{t('Device Mapping', 'ربط الأجهزة')}</TabsTrigger>
        </TabsList>

        {/* TAB 1: Daily Log */}
        <TabsContent value="daily" className="space-y-4">
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
              <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Department', 'القسم')}</TableHead>
                    <TableHead>{t('Check In', 'دخول')}</TableHead>
                    <TableHead>{t('Check Out', 'خروج')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Device', 'الجهاز')}</TableHead>
                    <TableHead className="text-end">{t('Actions', 'الإجراءات')}</TableHead>
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
                      <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-24 ms-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : !attendanceData || attendanceData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
                      <TableCell className="text-muted-foreground text-xs">{record.deviceName || '-'}</TableCell>
                      <TableCell className="text-end">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => openCorrectionDialog(record)}
                        >
                          {t('Request Correction', 'طلب تصحيح')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: Punch Events */}
        <TabsContent value="events">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {loadingAttendance ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent></Card>
              ))
            ) : !attendanceData || attendanceData.length === 0 ? (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                {t('No attendance records found.', 'لم يتم العثور على سجلات.')}
              </div>
            ) : (
              attendanceData.map((record) => {
                const initials = (lang === 'en' ? record.employeeNameEn : record.employeeNameAr)
                  .split(' ')
                  .map(n => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();
                
                return (
                  <Card key={record.id} className="hover:border-primary/50 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <Avatar className="h-10 w-10">
                          <AvatarFallback className="bg-primary/20 text-primary font-semibold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {lang === 'en' ? record.employeeNameEn : record.employeeNameAr}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {record.departmentNameEn}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-2 mb-2">
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-transparent">
                          IN {record.checkInTime || '--:--'}
                        </Badge>
                        <Badge className="bg-blue-500/10 text-blue-500 border-transparent">
                          OUT {record.checkOutTime || '--:--'}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                        <Clock className="w-3 h-3" />
                        <span>{record.workingHours ? `${record.workingHours.toFixed(1)}h` : '-'}</span>
                        {(record.lateMinutes ?? 0) > 0 && (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-transparent text-xs ms-auto">
                            Late {record.lateMinutes}min
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Cpu className="w-3 h-3" />
                          <span>{record.deviceName || 'Unknown Device'}</span>
                        </div>
                        {getStatusBadge(record.status)}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* TAB 3: Corrections */}
        <TabsContent value="corrections" className="space-y-4">
          <div className="flex gap-4">
            <Card className="flex-1">
              <CardContent className="p-4 flex items-center gap-3">
                <Clock className="w-8 h-8 text-amber-500" />
                <div>
                  <p className="text-2xl font-bold">{pendingCorrections.length}</p>
                  <p className="text-sm text-muted-foreground">{t('Pending', 'قيد الانتظار')}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="flex-1">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle className="w-8 h-8 text-emerald-500" />
                <div>
                  <p className="text-2xl font-bold">{approvedCorrections.length}</p>
                  <p className="text-sm text-muted-foreground">{t('Approved', 'تمت الموافقة')}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="flex-1">
              <CardContent className="p-4 flex items-center gap-3">
                <XCircle className="w-8 h-8 text-destructive" />
                <div>
                  <p className="text-2xl font-bold">{rejectedCorrections.length}</p>
                  <p className="text-sm text-muted-foreground">{t('Rejected', 'مرفوض')}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Date', 'التاريخ')}</TableHead>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('Change', 'التغيير')}</TableHead>
                    <TableHead>{t('Reason', 'السبب')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead className="text-end">{t('Actions', 'الإجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingCorrections ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-24 ms-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : corrections.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {t('No correction requests found.', 'لم يتم العثور على طلبات تصحيح.')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    corrections.map((correction) => (
                      <TableRow key={correction.id}>
                        <TableCell className="font-medium">
                          {lang === 'en' ? correction.employeeNameEn : correction.employeeNameAr}
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(correction.requestedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {correction.correctionType.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <span className="text-muted-foreground line-through">{correction.originalValue}</span>
                          {' → '}
                          <span className="text-primary font-semibold">{correction.requestedValue}</span>
                        </TableCell>
                        <TableCell className="text-sm max-w-xs truncate">{correction.reason}</TableCell>
                        <TableCell>
                          {correction.status === 'pending' && (
                            <Badge className="bg-amber-500/10 text-amber-500 border-transparent">
                              {t('Pending', 'قيد الانتظار')}
                            </Badge>
                          )}
                          {correction.status === 'approved' && (
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-transparent">
                              {t('Approved', 'تمت الموافقة')}
                            </Badge>
                          )}
                          {correction.status === 'rejected' && (
                            <Badge className="bg-destructive/10 text-destructive border-transparent">
                              {t('Rejected', 'مرفوض')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          {correction.status === 'pending' ? (
                            <div className="flex justify-end gap-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                disabled={decidingId === correction.id}
                                onClick={() => setRejectDialogId(correction.id)}
                              >
                                {t('Reject', 'رفض')}
                              </Button>
                              <Button 
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700"
                                disabled={decidingId === correction.id}
                                onClick={() => decideCorrection(correction.id, 'approved')}
                              >
                                {t('Approve', 'موافقة')}
                              </Button>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">
                              {correction.reviewedByUsername && (
                                <p>{t('By', 'بواسطة')}: {correction.reviewedByUsername}</p>
                              )}
                              {correction.reviewedAt && (
                                <p>{new Date(correction.reviewedAt).toLocaleDateString()}</p>
                              )}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Device Mapping */}
        <TabsContent value="devices">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-4">
            {/* Device List */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('Devices', 'الأجهزة')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 p-3">
                {!devices || devices.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {t('No devices found', 'لا توجد أجهزة')}
                  </p>
                ) : (
                  devices.map((device) => (
                    <div
                      key={device.id}
                      className={`p-3 rounded-md border cursor-pointer transition-colors ${
                        selectedDevice === device.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-muted/50'
                      }`}
                      onClick={() => handleDeviceSelect(device.id)}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-2 h-2 rounded-full ${
                          device.status === 'online' ? 'bg-emerald-500' : 'bg-muted-foreground'
                        }`} />
                        <span className="font-semibold text-sm">{device.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{lang === 'en' ? device.location : device.locationAr}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('Enrolled', 'مسجل')}: {deviceMappings.filter(m => m.deviceId === device.id).length}
                      </p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Employee Mappings */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    {selectedDevice 
                      ? `${devices?.find(d => d.id === selectedDevice)?.name} - ${t('Enrolled Employees', 'الموظفون المسجلون')}`
                      : t('Select a device', 'اختر جهازًا')
                    }
                  </CardTitle>
                  {selectedDevice && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {deviceMappings.length} {t('employees enrolled', 'موظف مسجل')}
                    </p>
                  )}
                </div>
                {selectedDevice && (
                  <Button size="sm" onClick={() => setEnrollDialog(true)}>
                    <Fingerprint className="w-4 h-4 me-2" />
                    {t('Enroll Employee', 'تسجيل موظف')}
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {!selectedDevice ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>{t('Select a device to view enrolled employees', 'اختر جهازًا لعرض الموظفين المسجلين')}</p>
                  </div>
                ) : loadingMappings ? (
                  <Skeleton className="h-48 w-full" />
                ) : deviceMappings.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p>{t('No employees enrolled on this device', 'لا يوجد موظفون مسجلون على هذا الجهاز')}</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('Employee', 'الموظف')}</TableHead>
                        <TableHead>{t('Biometric', 'البصمة')}</TableHead>
                        <TableHead>{t('Access Level', 'مستوى الوصول')}</TableHead>
                        <TableHead>{t('Enrolled', 'تاريخ التسجيل')}</TableHead>
                        <TableHead>{t('Active', 'نشط')}</TableHead>
                        <TableHead className="text-end">{t('Actions', 'الإجراءات')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deviceMappings.map((mapping) => {
                        const initials = (lang === 'en' ? mapping.employeeNameEn : mapping.employeeNameAr)
                          .split(' ')
                          .map(n => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase();

                        return (
                          <TableRow key={mapping.employeeId}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="bg-primary/20 text-primary text-xs">
                                    {initials}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium">
                                    {lang === 'en' ? mapping.employeeNameEn : mapping.employeeNameAr}
                                  </p>
                                  <p className="text-xs text-muted-foreground">{mapping.employeeNumber}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize text-xs">
                                {mapping.biometricType}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="capitalize text-xs">
                                {mapping.accessLevel}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(mapping.enrolledAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              {mapping.isActive ? (
                                <CheckCircle className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <XCircle className="w-4 h-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="text-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={() => removeMapping(mapping.deviceId, mapping.employeeId)}
                              >
                                {t('Remove', 'إزالة')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Correction Request Dialog */}
      <Dialog open={correctionDialog} onOpenChange={setCorrectionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Request Attendance Correction', 'طلب تصحيح الحضور')}</DialogTitle>
            <DialogDescription>
              {t('Submit a correction request for this attendance record', 'إرسال طلب تصحيح لسجل الحضور هذا')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Correction Type', 'نوع التصحيح')}</label>
              <Select value={correctionType} onValueChange={setCorrectionType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Select type', 'اختر النوع')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check_in">{t('Check In Time', 'وقت الدخول')}</SelectItem>
                  <SelectItem value="check_out">{t('Check Out Time', 'وقت الخروج')}</SelectItem>
                  <SelectItem value="status">{t('Status', 'الحالة')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Original Value', 'القيمة الأصلية')}</label>
              <Input 
                value={
                  correctionType === 'check_in' ? selectedAttendance?.checkInTime || '--:--' :
                  correctionType === 'check_out' ? selectedAttendance?.checkOutTime || '--:--' :
                  correctionType === 'status' ? selectedAttendance?.status || '' : ''
                }
                disabled
                className="bg-muted"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Requested Value', 'القيمة المطلوبة')}</label>
              <Input 
                value={requestedValue}
                onChange={(e) => setRequestedValue(e.target.value)}
                placeholder={t('Enter new value', 'أدخل القيمة الجديدة')}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Reason', 'السبب')}</label>
              <Textarea
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder={t('Explain why this correction is needed', 'اشرح سبب الحاجة إلى هذا التصحيح')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectionDialog(false)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button 
              onClick={submitCorrection}
              disabled={!correctionType || !requestedValue || !correctionReason || submittingCorrection}
            >
              {submittingCorrection ? t('Submitting...', 'جارٍ الإرسال...') : t('Submit', 'إرسال')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enroll Employee Dialog */}
      <Dialog open={enrollDialog} onOpenChange={setEnrollDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Enroll Employee to Device', 'تسجيل موظف على الجهاز')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Employee', 'الموظف')}</label>
              <Select value={enrollEmployeeId} onValueChange={setEnrollEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Select employee', 'اختر موظفًا')} />
                </SelectTrigger>
                <SelectContent>
                  {employees?.data?.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id.toString()}>
                      {lang === 'en' ? emp.firstNameEn + ' ' + emp.lastNameEn : emp.firstNameAr + ' ' + emp.lastNameAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Biometric Type', 'نوع البصمة')}</label>
              <Select value={enrollBiometricType} onValueChange={setEnrollBiometricType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fingerprint">{t('Fingerprint', 'بصمة الإصبع')}</SelectItem>
                  <SelectItem value="face">{t('Face', 'الوجه')}</SelectItem>
                  <SelectItem value="rfid">{t('RFID Card', 'بطاقة RFID')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Access Level', 'مستوى الوصول')}</label>
              <Select value={enrollAccessLevel} onValueChange={setEnrollAccessLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">{t('Standard', 'عادي')}</SelectItem>
                  <SelectItem value="supervisor">{t('Supervisor', 'مشرف')}</SelectItem>
                  <SelectItem value="admin">{t('Admin', 'مدير')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrollDialog(false)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button onClick={enrollEmployee} disabled={!enrollEmployeeId || enrolling}>
              {enrolling ? t('Enrolling...', 'جارٍ التسجيل...') : t('Enroll', 'تسجيل')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Correction Dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={(open) => !open && setRejectDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Reject Correction Request', 'رفض طلب التصحيح')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Review Note (Optional)', 'ملاحظة المراجعة (اختياري)')}</label>
              <Textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder={t('Add a reason for rejection...', 'أضف سببًا للرفض...')}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogId(null)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button 
              variant="destructive"
              onClick={() => rejectDialogId && decideCorrection(rejectDialogId, 'rejected', rejectNote)}
              disabled={decidingId === rejectDialogId}
            >
              {t('Reject', 'رفض')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
