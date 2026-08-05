import { useState } from 'react';
import { useParams } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetApplication,
  getGetApplicationQueryKey,
  useGetApplicant,
  getGetApplicantQueryKey,
  useShortlistApplication,
  useRejectApplication,
  useListInterviewScores,
  useCreateInterviewScore,
  useListBackgroundChecks,
  useCreateBackgroundCheck,
  useListJobOffers,
  useCreateJobOffer,
  useSendJobOffer,
  useAcceptJobOffer,
  useDeclineJobOffer,
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { ArrowLeft, User, Star, ShieldCheck, FileText, CheckCircle, XCircle } from 'lucide-react';
import { useLocation } from 'wouter';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Add Interview Score Dialog ────────────────────────────────────────────────
function AddScoreDialog({ open, onClose, applicationId }: { open: boolean; onClose: () => void; applicationId: number }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutate, isPending } = useCreateInterviewScore();
  const [form, setForm] = useState({ interviewerId: '', interviewDate: '', overallScore: '', technicalScore: '', communicationScore: '', notes: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit() {
    if (!form.interviewerId || !form.interviewDate) {
      toast({ title: t('Missing fields', 'حقول مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      id: applicationId,
      data: {
        applicationId,
        interviewerEmployeeId: parseInt(form.interviewerId),
        scheduledAt: form.interviewDate,
        overallScore: form.overallScore ? parseFloat(form.overallScore) : null,
        technicalScore: form.technicalScore ? parseFloat(form.technicalScore) : null,
        communicationScore: form.communicationScore ? parseFloat(form.communicationScore) : null,
        generalNotes: form.notes || null,
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/interview-scores'] });
        toast({ title: t('Score recorded', 'تم تسجيل الدرجة') });
        onClose();
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Add Interview Score', 'إضافة درجة المقابلة')}</DialogTitle>
          <DialogDescription>{t('Record interview evaluation scores', 'تسجيل درجات تقييم المقابلة')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder={t('Interviewer ID', 'معرف المحاور')} value={form.interviewerId} onChange={e => set('interviewerId', e.target.value)} type="number" />
          <Input type="date" value={form.interviewDate} onChange={e => set('interviewDate', e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder={t('Overall', 'الإجمالي')} value={form.overallScore} onChange={e => set('overallScore', e.target.value)} type="number" />
            <Input placeholder={t('Technical', 'التقني')} value={form.technicalScore} onChange={e => set('technicalScore', e.target.value)} type="number" />
            <Input placeholder={t('Communication', 'التواصل')} value={form.communicationScore} onChange={e => set('communicationScore', e.target.value)} type="number" />
          </div>
          <Textarea placeholder={t('Notes', 'ملاحظات')} value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Save', 'حفظ')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Initiate Background Check Dialog ─────────────────────────────────────────
function BackgroundCheckDialog({ open, onClose, applicationId }: { open: boolean; onClose: () => void; applicationId: number }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { mutate, isPending } = useCreateBackgroundCheck();
  const [checkType, setCheckType] = useState('');
  const [provider, setProvider] = useState('');

  function handleSubmit() {
    if (!checkType) {
      toast({ title: t('Select check type', 'اختر نوع الفحص'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        applicationId,
        checkType,
        provider: provider || null,
        status: 'initiated',
        initiatedAt: new Date().toISOString(),
      } as any,
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/background-checks'] });
        toast({ title: t('Check initiated', 'تم بدء الفحص') });
        onClose();
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Initiate Background Check', 'بدء الفحص الخلفي')}</DialogTitle>
          <DialogDescription>{t('Start a background verification process', 'بدء عملية التحقق')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder={t('Check Type (criminal, education...)', 'نوع الفحص')} value={checkType} onChange={e => setCheckType(e.target.value)} />
          <Input placeholder={t('Provider (optional)', 'المزود (اختياري)')} value={provider} onChange={e => setProvider(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Initiate', 'بدء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function RecruitmentApplication() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const appId = parseInt(params.id ?? '0');

  const { data: application, isLoading: appLoading } = useGetApplication(appId, { query: { enabled: appId > 0, queryKey: getGetApplicationQueryKey(appId) } });
  const applicantId = application?.applicantId ?? 0;
  const { data: applicant } = useGetApplicant(applicantId, { query: { enabled: applicantId > 0, queryKey: getGetApplicantQueryKey(applicantId) } });

  const { data: scoresData } = useListInterviewScores({ applicationId: appId } as any);
  const { data: checksData } = useListBackgroundChecks({ applicationId: appId } as any);
  const { data: offersData } = useListJobOffers({ applicationId: appId } as any);

  const scores = scoresData?.data ?? [];
  const checks = checksData?.data ?? [];
  const offers = offersData?.data ?? [];

  const { mutate: shortlist } = useShortlistApplication();
  const { mutate: reject } = useRejectApplication();
  const { mutate: sendOffer } = useSendJobOffer();
  const { mutate: acceptOffer } = useAcceptJobOffer();
  const { mutate: declineOffer } = useDeclineJobOffer();

  const [showScoreDialog, setShowScoreDialog] = useState(false);
  const [showBgDialog, setShowBgDialog] = useState(false);

  function handleShortlist() {
    shortlist({ id: appId }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/applications'] }); toast({ title: t('Shortlisted', 'تم الإدراج في القائمة المختصرة') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  function handleReject() {
    reject({ id: appId, data: { reason: 'Rejected by recruiter' } }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: ['/api/applications'] }); toast({ title: t('Rejected', 'تم الرفض') }); },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  if (appLoading) {
    return <AnimatedPage><div className="flex items-center justify-center h-64 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</div></AnimatedPage>;
  }

  if (!application) {
    return <AnimatedPage><div className="flex items-center justify-center h-64 text-muted-foreground">{t('Application not found', 'التقديم غير موجود')}</div></AnimatedPage>;
  }

  const latestOffer = offers[offers.length - 1];

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/recruitment')}>
            <ArrowLeft className="w-4 h-4 mr-1" />{t('Back', 'رجوع')}
          </Button>
          <div>
            <h1 className="text-xl font-bold">{t('Application', 'طلب التقديم')} #{appId}</h1>
            <p className="text-sm text-muted-foreground">
              {t('Status', 'الحالة')}: <span className="capitalize font-medium">{application.status.replace('_', ' ')}</span>
            </p>
          </div>
        </div>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t('Overview', 'نظرة عامة')}</TabsTrigger>
            <TabsTrigger value="interviews">{t('Interviews', 'المقابلات')}</TabsTrigger>
            <TabsTrigger value="background">{t('Background Check', 'الفحص الخلفي')}</TabsTrigger>
            <TabsTrigger value="offer">{t('Offer & Contract', 'العرض والعقد')}</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4 text-amber-500" />{t('Applicant Profile', 'ملف المتقدم')}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Name', 'الاسم')}</span><span className="font-medium">{applicant ? `${applicant.firstNameEn ?? ''} ${applicant.lastNameEn ?? ''}`.trim() || '—' : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Email', 'البريد')}</span><span>{applicant?.email ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Phone', 'الهاتف')}</span><span>{applicant?.phone ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Type', 'النوع')}</span><span className="capitalize">{applicant?.applicantType ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Source', 'المصدر')}</span><span>{applicant?.source ?? '—'}</span></div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-amber-500" />{t('Application Details', 'تفاصيل التقديم')}</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Posting ID', 'رقم الإعلان')}</span><span>#{application.jobPostingId}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Applied', 'تاريخ التقديم')}</span><span>{fmtDate(application.appliedAt)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('Status', 'الحالة')}</span>
                    <Badge variant="outline" className="capitalize text-xs">{application.status.replace('_', ' ')}</Badge>
                  </div>
                  {application.coverLetterText && (
                    <div><p className="text-muted-foreground mb-1">{t('Cover Letter', 'خطاب التقديم')}</p><p className="text-xs bg-muted p-2 rounded">{application.coverLetterText}</p></div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Timeline / Actions */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t('Actions', 'الإجراءات')}</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" className="text-amber-600 border-amber-400" onClick={handleShortlist} disabled={application.status === 'shortlisted'}>
                    <Star className="w-4 h-4 mr-1" />{t('Shortlist', 'إدراج في القائمة')}
                  </Button>
                  <Button variant="outline" className="text-red-600 border-red-400" onClick={handleReject} disabled={application.status === 'rejected'}>
                    <XCircle className="w-4 h-4 mr-1" />{t('Reject', 'رفض')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Interviews */}
          <TabsContent value="interviews" className="space-y-4 mt-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowScoreDialog(true)}>
                <Star className="w-4 h-4 mr-1" />{t('Add Score', 'إضافة درجة')}
              </Button>
            </div>
            {scores.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">{t('No interview scores yet', 'لا توجد درجات مقابلة بعد')}</CardContent></Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {scores.map(s => (
                  <Card key={s.id}>
                    <CardContent className="pt-4 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('Date', 'التاريخ')}</span><span>{fmtDate(s.conductedAt ?? s.scheduledAt)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('Overall', 'الإجمالي')}</span><span className="font-bold text-amber-500">{s.overallScore ?? '—'}/10</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('Technical', 'التقني')}</span><span>{s.technicalScore ?? '—'}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('Communication', 'التواصل')}</span><span>{s.communicationScore ?? '—'}</span></div>
                      {s.recommendation && <div className="mt-2 p-2 bg-muted rounded text-xs">{s.recommendation}</div>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Background Check */}
          <TabsContent value="background" className="space-y-4 mt-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowBgDialog(true)}>
                <ShieldCheck className="w-4 h-4 mr-1" />{t('Initiate Check', 'بدء الفحص')}
              </Button>
            </div>
            {checks.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">{t('No background checks initiated', 'لم يبدأ أي فحص خلفي')}</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {checks.map(c => (
                  <Card key={c.id}>
                    <CardContent className="pt-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium capitalize">{c.checkType}</p>
                        <p className="text-xs text-muted-foreground">{t('Provider', 'المزود')}: {c.provider ?? '—'}</p>
                      </div>
                      <Badge variant="outline" className={cn('capitalize text-xs',
                        c.status === 'passed' ? 'border-emerald-400 text-emerald-600' :
                          c.status === 'failed' ? 'border-red-400 text-red-600' :
                            'border-amber-400 text-amber-600'
                      )}>
                        {c.status}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Offer & Contract */}
          <TabsContent value="offer" className="space-y-4 mt-4">
            {latestOffer ? (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{t('Current Offer', 'العرض الحالي')}</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div><p className="text-muted-foreground">{t('Base Salary', 'الراتب الأساسي')}</p><p className="text-xl font-bold text-amber-500">{latestOffer.baseSalary ?? '—'} {latestOffer.currency ?? 'SAR'}</p></div>
                    <div><p className="text-muted-foreground">{t('Status', 'الحالة')}</p>
                      <Badge variant="outline" className={cn('capitalize text-xs mt-1',
                        latestOffer.status === 'accepted' ? 'border-emerald-400 text-emerald-600' :
                          latestOffer.status === 'declined' ? 'border-red-400 text-red-600' :
                            'border-amber-400 text-amber-600'
                      )}>
                        {latestOffer.status}
                      </Badge>
                    </div>
                    <div><p className="text-muted-foreground">{t('Start Date', 'تاريخ البدء')}</p><p>{fmtDate(latestOffer.proposedStartDate)}</p></div>
                    <div><p className="text-muted-foreground">{t('Valid Until', 'صالح حتى')}</p><p>{fmtDate(latestOffer.offerValidUntil)}</p></div>
                  </div>
                  <div className="flex gap-2 pt-2 flex-wrap">
                    {latestOffer.status === 'draft' && (
                      <Button size="sm" onClick={() => sendOffer({ id: latestOffer.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/job-offers'] }) })}>
                        {t('Send Offer', 'إرسال العرض')}
                      </Button>
                    )}
                    {latestOffer.status === 'sent' && (
                      <>
                        <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-400" onClick={() => acceptOffer({ id: latestOffer.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/job-offers'] }) })}>
                          <CheckCircle className="w-4 h-4 mr-1" />{t('Accept', 'قبول')}
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-600 border-red-400" onClick={() => declineOffer({ id: latestOffer.id, data: { reason: 'Declined' } }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['/api/job-offers'] }) })}>
                          <XCircle className="w-4 h-4 mr-1" />{t('Decline', 'رفض')}
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card><CardContent className="py-12 text-center text-muted-foreground">{t('No offer created yet', 'لم يتم إنشاء عرض بعد')}</CardContent></Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AddScoreDialog open={showScoreDialog} onClose={() => setShowScoreDialog(false)} applicationId={appId} />
      <BackgroundCheckDialog open={showBgDialog} onClose={() => setShowBgDialog(false)} applicationId={appId} />
    </AnimatedPage>
  );
}
