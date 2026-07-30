import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListDisciplinaryRecords,
  useCreateDisciplinaryRecord,
  useListCommendationRecords,
  useListPromotionRecommendations,
  useCreatePromotionRecommendation,
  useListEmployees,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AlertTriangle, Plus, TrendingUp } from 'lucide-react';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const SEVERITY_COLORS: Record<string, string> = {
  minor: 'border-yellow-400 text-yellow-600',
  moderate: 'border-orange-400 text-orange-600',
  major: 'border-red-400 text-red-600',
  gross_misconduct: 'border-red-700 text-red-800 bg-red-50',
};

// ─── New Disciplinary Record Dialog ───────────────────────────────────────────
function NewDisciplinaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { mutate, isPending } = useCreateDisciplinaryRecord();
  const [form, setForm] = useState({
    employeeId: '', incidentDate: '', severity: 'minor', incidentType: '', description: '', actionTaken: '',
  });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit() {
    if (!form.employeeId || !form.incidentDate || !form.incidentType) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        employeeId: parseInt(form.employeeId),
        incidentDate: form.incidentDate,
        severity: form.severity,
        incidentType: form.incidentType,
        description: form.description || '',
        actionTaken: form.actionTaken || null,
        status: 'active',
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/disciplinary-records'] });
        toast({ title: t('Record created', 'تم إنشاء السجل') });
        onClose();
        setForm({ employeeId: '', incidentDate: '', severity: 'minor', incidentType: '', description: '', actionTaken: '' });
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  const emps = empData?.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New Disciplinary Record', 'سجل تأديبي جديد')}</DialogTitle>
          <DialogDescription>{t('Record a disciplinary incident', 'تسجيل حادثة تأديبية')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={form.employeeId} onValueChange={v => set('employeeId', v)}>
            <SelectTrigger><SelectValue placeholder={t('Select Employee', 'اختر الموظف')} /></SelectTrigger>
            <SelectContent>{emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="date" value={form.incidentDate} onChange={e => set('incidentDate', e.target.value)} />
          <Input placeholder={t('Incident Type', 'نوع الحادثة')} value={form.incidentType} onChange={e => set('incidentType', e.target.value)} />
          <Select value={form.severity} onValueChange={v => set('severity', v)}>
            <SelectTrigger><SelectValue placeholder={t('Severity', 'الخطورة')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="minor">{t('Minor', 'خفيف')}</SelectItem>
              <SelectItem value="moderate">{t('Moderate', 'متوسط')}</SelectItem>
              <SelectItem value="major">{t('Major', 'خطير')}</SelectItem>
              <SelectItem value="gross_misconduct">{t('Gross Misconduct', 'سلوك مخالف جسيم')}</SelectItem>
            </SelectContent>
          </Select>
          <Textarea placeholder={t('Description', 'الوصف')} value={form.description} onChange={e => set('description', e.target.value)} rows={3} />
          <Textarea placeholder={t('Action Taken', 'الإجراء المتخذ')} value={form.actionTaken} onChange={e => set('actionTaken', e.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Recommend Promotion Dialog ────────────────────────────────────────────────
function PromotionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: empData } = useListEmployees({ limit: 500 } as any);
  const { mutate, isPending } = useCreatePromotionRecommendation();
  const [form, setForm] = useState({ employeeId: '', recommendedBy: '', justification: '', effectiveDate: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  const emps = empData?.data ?? [];

  function handleSubmit() {
    if (!form.employeeId || !form.recommendedBy) {
      toast({ title: t('Missing required fields', 'حقول مطلوبة مفقودة'), variant: 'destructive' });
      return;
    }
    mutate({
      data: {
        employeeId: parseInt(form.employeeId),
        recommendedBy: parseInt(form.recommendedBy),
        justification: form.justification || null,
        effectiveDate: form.effectiveDate || null,
        status: 'pending',
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['/api/promotion-recommendations'] });
        toast({ title: t('Recommendation submitted', 'تم تقديم التوصية') });
        onClose();
        setForm({ employeeId: '', recommendedBy: '', justification: '', effectiveDate: '' });
      },
      onError: (e: any) => toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Recommend Promotion', 'توصية بترقية')}</DialogTitle>
          <DialogDescription>{t('Submit a promotion recommendation', 'تقديم توصية بترقية موظف')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={form.employeeId} onValueChange={v => set('employeeId', v)}>
            <SelectTrigger><SelectValue placeholder={t('Employee', 'الموظف')} /></SelectTrigger>
            <SelectContent>{emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={form.recommendedBy} onValueChange={v => set('recommendedBy', v)}>
            <SelectTrigger><SelectValue placeholder={t('Recommended By', 'موصى به من')} /></SelectTrigger>
            <SelectContent>{emps.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.firstNameEn} {e.lastNameEn}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="date" value={form.effectiveDate} onChange={e => set('effectiveDate', e.target.value)} />
          <Textarea placeholder={t('Justification', 'المبرر')} value={form.justification} onChange={e => set('justification', e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSubmit} disabled={isPending}>{t('Submit', 'تقديم')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function Disciplinary() {
  const { t } = useLanguage();
  const [showNew, setShowNew] = useState(false);
  const [showPromo, setShowPromo] = useState(false);

  const { data: discData, isLoading: discLoading } = useListDisciplinaryRecords({ limit: 200 } as any);
  const { data: commData, isLoading: commLoading } = useListCommendationRecords({ limit: 200 } as any);
  const { data: promoData } = useListPromotionRecommendations({ limit: 200 } as any);

  const discRecords = discData?.data ?? [];
  const commRecords = commData?.data ?? [];
  const promoRecords = promoData?.data ?? [];

  return (
    <AnimatedPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            {t('Disciplinary & Commendations', 'التأديب والتكريم')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('Disciplinary records, commendations, and promotions', 'السجلات التأديبية والتكريم والترقيات')}</p>
        </div>

        <Tabs defaultValue="disciplinary">
          <TabsList>
            <TabsTrigger value="disciplinary">{t('Disciplinary Records', 'السجلات التأديبية')} ({discRecords.length})</TabsTrigger>
            <TabsTrigger value="commendations">{t('Commendations & Promotions', 'التكريم والترقيات')} ({commRecords.length + promoRecords.length})</TabsTrigger>
          </TabsList>

          {/* Disciplinary */}
          <TabsContent value="disciplinary" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowNew(true)}>
                <Plus className="w-4 h-4 mr-1" />{t('New Record', 'سجل جديد')}
              </Button>
            </div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Date', 'التاريخ')}</TableHead>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('Severity', 'الخطورة')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead>{t('Action Taken', 'الإجراء')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
                  ) : discRecords.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t('No disciplinary records', 'لا توجد سجلات تأديبية')}</TableCell></TableRow>
                  ) : discRecords.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>#{r.employeeId}</TableCell>
                      <TableCell>{fmtDate(r.incidentDate)}</TableCell>
                      <TableCell className="capitalize">{r.incidentType}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs', SEVERITY_COLORS[r.severity] ?? '')}>
                          {r.severity.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs max-w-48 truncate">{r.actionTaken ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Commendations & Promotions */}
          <TabsContent value="commendations" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowPromo(true)}>
                <TrendingUp className="w-4 h-4 mr-1" />{t('Recommend Promotion', 'توصية بترقية')}
              </Button>
            </div>

            <div className="font-medium text-sm text-muted-foreground px-1">{t('Commendation Records', 'سجلات التكريم')}</div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Date', 'التاريخ')}</TableHead>
                    <TableHead>{t('Type', 'النوع')}</TableHead>
                    <TableHead>{t('Description', 'الوصف')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commLoading ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{t('Loading...', 'جارٍ التحميل...')}</TableCell></TableRow>
                  ) : commRecords.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">{t('No commendation records', 'لا توجد سجلات تكريم')}</TableCell></TableRow>
                  ) : commRecords.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>#{r.employeeId}</TableCell>
                      <TableCell>{fmtDate(r.commendationDate)}</TableCell>
                      <TableCell className="capitalize">{r.commendationType ?? '—'}</TableCell>
                      <TableCell className="text-xs max-w-64 truncate">{r.description ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>

            <div className="font-medium text-sm text-muted-foreground px-1 mt-4">{t('Promotion Recommendations', 'توصيات الترقية')}</div>
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Employee', 'الموظف')}</TableHead>
                    <TableHead>{t('Recommended By', 'موصى به من')}</TableHead>
                    <TableHead>{t('Position ID', 'رقم المنصب')}</TableHead>
                    <TableHead>{t('Effective Date', 'تاريخ التفعيل')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promoRecords.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">{t('No promotion recommendations', 'لا توجد توصيات ترقية')}</TableCell></TableRow>
                  ) : promoRecords.map(r => (
                    <TableRow key={r.id}>
                      <TableCell>#{r.employeeId}</TableCell>
                      <TableCell>#{r.recommendedBy}</TableCell>
                      <TableCell>{r.recommendedPositionId != null ? `#${r.recommendedPositionId}` : '—'}</TableCell>
                      <TableCell>{fmtDate(r.effectiveDate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize text-xs',
                          r.status === 'approved' ? 'border-emerald-400 text-emerald-600' :
                            r.status === 'rejected' ? 'border-red-400 text-red-600' :
                              'border-amber-400 text-amber-600'
                        )}>
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <NewDisciplinaryDialog open={showNew} onClose={() => setShowNew(false)} />
      <PromotionDialog open={showPromo} onClose={() => setShowPromo(false)} />
    </AnimatedPage>
  );
}
