import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListTrainingPrograms,
  useListTrainingSessions,
  useListCourseNominations,
  useCreateCourseNomination,
  useUpdateCourseNomination,
  useListTrainingAttendance,
  useListCertifications,
  useCreateCertification,
  useListEmployees,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { GraduationCap, Plus, CheckCircle, XCircle, Users, Award } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isExpired(d?: string | null) {
  if (!d) return false;
  return new Date(d) < new Date();
}

function isExpiringSoon(d?: string | null) {
  if (!d) return false;
  const diff = new Date(d).getTime() - Date.now();
  return diff > 0 && diff < 30 * 86400000;
}

// ─── Add Certification Dialog ──────────────────────────────────────────────────
function AddCertDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { mutate, isPending } = useCreateCertification();
  const [form, setForm] = useState({
    employeeId: '', certName: '', certType: '', issuingBody: '', issuedDate: '', expiryDate: '',
  });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  const emps = empData?.data ?? [];

  function handleSubmit() {
    if (!form.employeeId || !form.certName) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        employeeId: parseInt(form.employeeId),
        certName: form.certName,
        certType: form.certType || null,
        issuingBody: form.issuingBody || null,
        issuedDate: form.issuedDate || null,
        expiryDate: form.expiryDate || null,
        status: 'active',
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/certifications'] });
        toast({ title: t('Certification added', 'تم إضافة الشهادة') });
        onClose();
        setForm({ employeeId: '', certName: '', certType: '', issuingBody: '', issuedDate: '', expiryDate: '' });
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Add Certification', 'إضافة شهادة')}</DialogTitle>
          <DialogDescription>{t('Record a new certification for an employee', 'تسجيل شهادة جديدة لموظف')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={form.employeeId} onValueChange={v => set('employeeId', v)}>
            <SelectTrigger><SelectValue placeholder={t('Select Employee', 'اختر الموظف')} /></SelectTrigger>
            <SelectContent>{emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder={t('Certification Name', 'اسم الشهادة')} value={form.certName} onChange={e => set('certName', e.target.value)} />
          <Input placeholder={t('Type', 'النوع')} value={form.certType} onChange={e => set('certType', e.target.value)} />
          <Input placeholder={t('Issuing Body', 'الجهة المُصدِرة')} value={form.issuingBody} onChange={e => set('issuingBody', e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-muted-foreground mb-1 block">{t('Issued Date', 'تاريخ الإصدار')}</label><Input type="date" value={form.issuedDate} onChange={e => set('issuedDate', e.target.value)} /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">{t('Expiry Date', 'تاريخ الانتهاء')}</label><Input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Add', 'إضافة')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function Training() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [programFilter, setProgramFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState('');
  const [showCertDialog, setShowCertDialog] = useState(false);
  const [attendanceSubTab, setAttendanceSubTab] = useState<'attendance' | 'certifications'>('attendance');

  const { data: programsData } = useListTrainingPrograms({ limit: 50 } as any);
  const { data: sessionsData, isLoading: sessionsLoading } = useListTrainingSessions({ limit: 100 } as any);
  const { data: nominationsData, isLoading: nomLoading } = useListCourseNominations({ limit: 200 } as any);
  const { data: attendanceData } = useListTrainingAttendance({ sessionId: selectedSession ? parseInt(selectedSession) : undefined, limit: 100 } as any);
  const { data: certData, isLoading: certLoading } = useListCertifications({ limit: 200 } as any);
  const { data: empData } = useListEmployees({ limit: 500 } as any);

  const { mutate: createNomination } = useCreateCourseNomination();
  const { mutate: updateNomination } = useUpdateCourseNomination();

  const programs = programsData?.data ?? [];
  const sessions = sessionsData?.data ?? [];
  const nominations = nominationsData?.data ?? [];
  const attendance = attendanceData?.data ?? [];
  const certifications = certData?.data ?? [];
  const emps = empData?.data ?? [];

  const filteredSessions = programFilter
    ? sessions.filter(s => {
        // sessions have courseId, not programId directly; filter by name for now
        return true;
      })
    : sessions;

  function approveNomination(id: number) {
    updateNomination({ id, data: { status: 'approved', approvedAt: new Date().toISOString() } as any }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/course-nominations'] }); toast({ title: t('Approved', 'تمت الموافقة') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  function rejectNomination(id: number) {
    updateNomination({ id, data: { status: 'rejected' } as any }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/course-nominations'] }); toast({ title: t('Rejected', 'تم الرفض') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  function getEmpName(id: number) {
    const e = emps.find(e => e.id === id);
    return e ? `${e.firstNameEn} ${e.lastNameEn}` : `#${id}`;
  }

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-amber-500" />
            {t('Training', 'التدريب')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('Courses, sessions, nominations, attendance, and certifications', 'الدورات والجلسات والترشيحات والحضور والشهادات')}</p>
        </div>

        <Tabs defaultValue="sessions">
          <TabsList>
            <TabsTrigger value="sessions">{t('Courses & Sessions', 'الدورات والجلسات')}</TabsTrigger>
            <TabsTrigger value="nominations">{t('Nominations', 'الترشيحات')}</TabsTrigger>
            <TabsTrigger value="attendance">{t('Attendance & Certifications', 'الحضور والشهادات')}</TabsTrigger>
          </TabsList>

          {/* Sessions */}
          <TabsContent value="sessions" className="mt-4 space-y-4">
            <div className="flex gap-3 items-center">
              <Select value={programFilter} onValueChange={setProgramFilter}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder={t('Filter by Program', 'فلترة حسب البرنامج')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('All Programs', 'جميع البرامج')}</SelectItem>
                  {programs.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Badge variant="outline">{filteredSessions.length} {t('sessions', 'جلسات')}</Badge>
            </div>

            {sessionsLoading ? (
              <div className="text-center py-12 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {filteredSessions.map(session => {
                  const maxPart = 20; // default display limit
                  const pct = Math.min(100, Math.round((session.enrolledCount / maxPart) * 100));
                  return (
                    <Card key={session.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-base">{session.sessionName}</CardTitle>
                          <Badge variant="outline" className={cn('capitalize text-xs shrink-0 ml-2',
                            session.status === 'active' ? 'border-emerald-400 text-emerald-600' :
                              session.status === 'completed' ? 'border-gray-400 text-gray-500' :
                                'border-amber-400 text-amber-600'
                          )}>
                            {session.status}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div className="flex justify-between"><span>{t('Dates', 'التواريخ')}</span><span>{fmtDate(session.startDate)} → {fmtDate(session.endDate)}</span></div>
                          {session.location && <div className="flex justify-between"><span>{t('Location', 'المكان')}</span><span>{session.location}</span></div>}
                          {session.trainer && <div className="flex justify-between"><span>{t('Trainer', 'المدرب')}</span><span>{session.trainer}</span></div>}
                        </div>
                        {/* Enrollment bar */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground">{t('Enrollment', 'التسجيل')}</span>
                            <span>{session.enrolledCount}</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full">
                            <div className={cn('h-full rounded-full transition-all', pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <Button size="sm" variant="outline" className="w-full" onClick={() => {
                          createNomination({ data: { sessionId: session.id, employeeId: 0, status: 'pending', nominatedAt: new Date().toISOString() } }, {
                            onSuccess: () => toast({ title: t('Nomination sent', 'تم إرسال الترشيح') }),
                          });
                        }}>
                          <Users className="w-3 h-3 mr-1" />{t('Nominate', 'ترشيح')}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Nominations */}
          <TabsContent value="nominations" className="mt-4">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Session', 'الجلسة')}</TableHead>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Nominated By', 'رُشِّح من')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Nominated', 'تاريخ الترشيح')}</TableHead>
                    <TableHead>{t('Actions', 'إجراءات')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nomLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
                  ) : nominations.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('No nominations found', 'لا توجد ترشيحات')}</TableCell></TableRow>
                  ) : nominations.map(n => (
                    <TableRow key={n.id}>
                      <TableCell>#{n.sessionId}</TableCell>
                      <TableCell>{getEmpName(n.employeeId)}</TableCell>
                      <TableCell>{n.nominatedBy ? getEmpName(n.nominatedBy) : '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs',
                          n.status === 'approved' ? 'border-emerald-400 text-emerald-600' :
                            n.status === 'rejected' ? 'border-red-400 text-red-600' :
                              'border-amber-400 text-amber-600'
                        )}>
                          {n.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{fmtDate(n.nominatedAt)}</TableCell>
                      <TableCell>
                        {n.status === 'pending' && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400" onClick={() => approveNomination(n.id)}>
                              <CheckCircle className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="text-red-600 border-red-400" onClick={() => rejectNomination(n.id)}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Attendance & Certifications */}
          <TabsContent value="attendance" className="mt-4 space-y-4">
            <div className="flex gap-2 border-b pb-2">
              <button
                onClick={() => setAttendanceSubTab('attendance')}
                className={cn('px-3 py-1.5 text-sm font-medium rounded-t', attendanceSubTab === 'attendance' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground')}
              >
                {t('Attendance', 'الحضور')}
              </button>
              <button
                onClick={() => setAttendanceSubTab('certifications')}
                className={cn('px-3 py-1.5 text-sm font-medium rounded-t', attendanceSubTab === 'certifications' ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground')}
              >
                {t('Certifications', 'الشهادات')}
              </button>
            </div>

            {attendanceSubTab === 'attendance' && (
              <div className="space-y-3">
                <Select value={selectedSession} onValueChange={setSelectedSession}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder={t('Select Session', 'اختر الجلسة')} />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.sessionName}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('Employee', 'الموظف')}</TableHead>
                        <TableHead>{t('Date', 'التاريخ')}</TableHead>
                        <TableHead>{t('Status', 'الحالة')}</TableHead>
                        <TableHead>{t('Hours', 'الساعات')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attendance.length === 0 ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{selectedSession ? t('No attendance records', 'لا توجد سجلات حضور') : t('Select a session', 'اختر جلسة')}</TableCell></TableRow>
                      ) : attendance.map(a => (
                        <TableRow key={a.id}>
                          <TableCell>{getEmpName(a.employeeId)}</TableCell>
                          <TableCell>{fmtDate(a.attendanceDate)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('capitalize text-xs',
                              a.status === 'present' ? 'border-emerald-400 text-emerald-600' :
                                a.status === 'absent' ? 'border-red-400 text-red-600' :
                                  'border-amber-400 text-amber-600'
                            )}>
                              {a.status}
                            </Badge>
                          </TableCell>
                          <TableCell>{a.hoursAttended ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            )}

            {attendanceSubTab === 'certifications' && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => setShowCertDialog(true)}>
                    <Plus className="w-4 h-4 mr-1" />{t('Add Certification', 'إضافة شهادة')}
                  </Button>
                </div>
                <Card>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('Employee', 'الموظف')}</TableHead>
                        <TableHead>{t('Certification', 'الشهادة')}</TableHead>
                        <TableHead>{t('Type', 'النوع')}</TableHead>
                        <TableHead>{t('Issuer', 'الجهة')}</TableHead>
                        <TableHead>{t('Issued', 'الإصدار')}</TableHead>
                        <TableHead>{t('Expiry', 'الانتهاء')}</TableHead>
                        <TableHead>{t('Status', 'الحالة')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {certLoading ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
                      ) : certifications.length === 0 ? (
                        <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('No certifications found', 'لا توجد شهادات')}</TableCell></TableRow>
                      ) : certifications.map(c => (
                        <TableRow key={c.id} className={cn(isExpired(c.expiryDate) ? 'bg-red-50/10' : isExpiringSoon(c.expiryDate) ? 'bg-amber-50/10' : '')}>
                          <TableCell>{getEmpName(c.employeeId)}</TableCell>
                          <TableCell className="font-medium">{c.certName}</TableCell>
                          <TableCell>{c.certType ?? '—'}</TableCell>
                          <TableCell>{c.issuingBody ?? '—'}</TableCell>
                          <TableCell>{fmtDate(c.issuedDate)}</TableCell>
                          <TableCell>
                            <span className={cn('text-xs font-medium',
                              isExpired(c.expiryDate) ? 'text-red-600' :
                                isExpiringSoon(c.expiryDate) ? 'text-amber-600' :
                                  'text-muted-foreground'
                            )}>
                              {fmtDate(c.expiryDate)}
                              {isExpired(c.expiryDate) && ' ⚠'}
                              {isExpiringSoon(c.expiryDate) && ' ⚡'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('capitalize text-xs',
                              c.status === 'active' ? 'border-emerald-400 text-emerald-600' :
                                c.status === 'expired' ? 'border-red-400 text-red-600' :
                                  'border-gray-400 text-gray-500'
                            )}>
                              {c.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AddCertDialog open={showCertDialog} onClose={() => setShowCertDialog(false)} />
    </AnimatedPage>
  );
}
