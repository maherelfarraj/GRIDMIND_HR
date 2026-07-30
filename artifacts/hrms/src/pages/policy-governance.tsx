import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GitBranch, Plus, AlertTriangle, CheckCircle, XCircle, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function policyAreaBadge(area: string) {
  const map: Record<string, string> = {
    leave: 'bg-emerald-900/40 text-emerald-300 border-emerald-700',
    payroll: 'bg-blue-900/40 text-blue-300 border-blue-700',
    attendance: 'bg-cyan-900/40 text-cyan-300 border-cyan-700',
    security: 'bg-red-900/40 text-red-300 border-red-700',
    recruitment: 'bg-purple-900/40 text-purple-300 border-purple-700',
    performance: 'bg-amber-900/40 text-amber-300 border-amber-700',
  };
  return map[area] ?? 'bg-slate-700 text-slate-300 border-slate-600';
}

function statusBadge(status: string) {
  if (status === 'draft') return 'bg-slate-700 text-slate-300 border-slate-600';
  if (status === 'pending_review') return 'bg-amber-900/40 text-amber-300 border-amber-700';
  if (status === 'approved' || status === 'applied') return 'bg-emerald-900/40 text-emerald-300 border-emerald-700';
  if (status === 'rejected') return 'bg-red-900/40 text-red-300 border-red-700';
  if (status === 'withdrawn') return 'bg-slate-600 text-slate-400 border-slate-600';
  return 'bg-slate-700 text-slate-300 border-slate-600';
}

function NewChangeDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ policyArea: '', titleEn: '', titleAr: '', targetEntityType: '', changeAfterJson: '' });
  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }
  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/policy-change-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error();
      toast({ title: t('Change request created', 'تم إنشاء طلب التغيير') });
      onSaved(); onClose();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
    finally { setSaving(false); }
  }
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-lg">
        <DialogHeader><DialogTitle>{t('New Change Request', 'طلب تغيير جديد')}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>{t('Policy Area', 'مجال السياسة')}</Label>
            <Select value={form.policyArea} onValueChange={v => set('policyArea', v)}>
              <SelectTrigger className="mt-1 bg-slate-700 border-slate-600"><SelectValue placeholder={t('Select area', 'اختر المجال')} /></SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {['leave','payroll','attendance','security','recruitment','performance'].map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t('Title (EN)', 'العنوان (إنجليزي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.titleEn} onChange={e => set('titleEn', e.target.value)} /></div>
            <div><Label>{t('Title (AR)', 'العنوان (عربي)')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" dir="rtl" value={form.titleAr} onChange={e => set('titleAr', e.target.value)} /></div>
          </div>
          <div><Label>{t('Target Entity Type', 'نوع الكيان المستهدف')}</Label><Input className="mt-1 bg-slate-700 border-slate-600" value={form.targetEntityType} onChange={e => set('targetEntityType', e.target.value)} placeholder="employee, organization..." /></div>
          <div><Label>{t('Change (JSON)', 'التغيير (JSON)')}</Label>
            <Textarea className="mt-1 bg-slate-700 border-slate-600 font-mono text-xs h-28 resize-none" value={form.changeAfterJson} onChange={e => set('changeAfterJson', e.target.value)} placeholder='{"maxLeaveDays": 30}' />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-md">
        <DialogHeader><DialogTitle>{t('Reject Change Request', 'رفض طلب التغيير')}</DialogTitle><DialogDescription className="text-slate-400">{t('Please provide a reason for rejection.', 'يرجى تقديم سبب الرفض.')}</DialogDescription></DialogHeader>
        <div className="py-2"><Label>{t('Rejection Reason', 'سبب الرفض')}</Label><Textarea className="mt-1 bg-slate-700 border-slate-600 h-24 resize-none" value={reason} onChange={e => setReason(e.target.value)} /></div>
        <DialogFooter>
          <Button variant="outline" className="border-slate-600" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button onClick={() => { onConfirm(reason); setReason(''); }} className="bg-red-600 hover:bg-red-700">{t('Reject', 'رفض')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiffBlock({ label, json }: { label: string; json: any }) {
  if (!json) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-400 uppercase">{label}</p>
      <pre className="bg-slate-900 border border-slate-700 rounded p-2 text-xs font-mono text-slate-300 overflow-auto max-h-32">{JSON.stringify(json, null, 2)}</pre>
    </div>
  );
}

export default function PolicyGovernance() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newChangeOpen, setNewChangeOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [rollbackTarget, setRollbackTarget] = useState<any>(null);
  const [rollbackReason, setRollbackReason] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/policy-change-requests');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : []);
    } catch { setRequests([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function submitForReview(id: number) {
    try {
      await fetch(`/api/policy-change-requests/${id}/submit`, { method: 'POST' });
      toast({ title: t('Submitted for review', 'تم الإرسال للمراجعة') });
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function withdraw(id: number) {
    try {
      await fetch(`/api/policy-change-requests/${id}/withdraw`, { method: 'POST' });
      toast({ title: t('Withdrawn', 'تم السحب') });
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function approve(id: number) {
    try {
      await fetch(`/api/policy-change-requests/${id}/approve`, { method: 'POST' });
      toast({ title: t('Approved', 'تمت الموافقة') });
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function reject(id: number, reason: string) {
    try {
      await fetch(`/api/policy-change-requests/${id}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
      toast({ title: t('Rejected', 'تم الرفض') });
      setRejectTarget(null);
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  async function rollback(id: number) {
    try {
      await fetch(`/api/policy-change-requests/${id}/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rollbackReason }) });
      toast({ title: t('Rolled back', 'تم التراجع') });
      setRollbackTarget(null);
      setRollbackReason('');
      load();
    } catch { toast({ title: t('Error', 'خطأ'), variant: 'destructive' }); }
  }

  function toggleExpand(id: number) {
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  const pending = requests.filter(r => r.status === 'draft');
  const review = requests.filter(r => r.status === 'pending_review');
  const history = requests.filter(r => ['applied','rejected','withdrawn'].includes(r.status));

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <GitBranch className="w-7 h-7 text-amber-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Policy Governance', 'حوكمة السياسات')}</h1>
            <p className="text-slate-400 text-sm">{t('Maker-checker policy change management', 'إدارة تغييرات السياسات بنظام الفصل بين الصلاحيات')}</p>
          </div>
        </div>

        <div className="rounded-md border border-amber-700/50 bg-amber-900/30 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-amber-400 text-sm">{t('Policy changes go through maker-checker review. Changes are not applied until approved and explicitly applied.', 'تمر تغييرات السياسات عبر مراجعة ذات اتجاهين. لا يتم تطبيق التغييرات حتى تتم الموافقة عليها وتطبيقها صراحةً.')}</p>
        </div>

        <Tabs defaultValue="pending">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="pending" className="data-[state=active]:bg-slate-700">{t('Pending Changes', 'التغييرات المعلقة')} {pending.length > 0 && <span className="ms-1 bg-slate-600 text-slate-200 rounded-full px-1.5 text-xs">{pending.length}</span>}</TabsTrigger>
            <TabsTrigger value="review" className="data-[state=active]:bg-slate-700">{t('Review Queue', 'قائمة المراجعة')} {review.length > 0 && <span className="ms-1 bg-amber-700 text-amber-200 rounded-full px-1.5 text-xs">{review.length}</span>}</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-slate-700">{t('History', 'السجل')}</TabsTrigger>
          </TabsList>

          {/* Pending Tab */}
          <TabsContent value="pending" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={() => setNewChangeOpen(true)} className="bg-blue-600 hover:bg-blue-700 gap-2"><Plus className="w-4 h-4" />{t('New Change Request', 'طلب تغيير جديد')}</Button>
            </div>
            {loading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-700" />)}</div> : (
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow className="border-slate-700 bg-slate-700/50">
                      <TableHead className="text-slate-300">{t('Title', 'العنوان')}</TableHead>
                      <TableHead className="text-slate-300">{t('Policy Area', 'مجال السياسة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Status', 'الحالة')}</TableHead>
                      <TableHead className="text-slate-300">{t('Maker', 'المُنشئ')}</TableHead>
                      <TableHead className="text-slate-300">{t('Submitted', 'مُقدَّم')}</TableHead>
                      <TableHead className="text-slate-300">{t('Actions', 'الإجراءات')}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {pending.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-slate-400 py-8">{t('No pending changes', 'لا توجد تغييرات معلقة')}</TableCell></TableRow>
                      : pending.map(r => (
                        <TableRow key={r.id} className="border-slate-700 hover:bg-slate-700/30">
                          <TableCell className="text-white font-medium">{r.titleEn}</TableCell>
                          <TableCell><Badge variant="outline" className={`text-xs ${policyAreaBadge(r.policyArea)}`}>{r.policyArea}</Badge></TableCell>
                          <TableCell><Badge variant="outline" className={`text-xs ${statusBadge(r.status)}`}>{r.status}</Badge></TableCell>
                          <TableCell className="text-slate-300 text-sm">{r.makerId ?? '—'}</TableCell>
                          <TableCell className="text-slate-300 text-sm">{fmtDate(r.submittedAt)}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-7 px-2" onClick={() => submitForReview(r.id)}>{t('Submit', 'إرسال')}</Button>
                              <Button size="sm" variant="ghost" className="text-slate-400 hover:text-slate-300 h-7 px-2" onClick={() => withdraw(r.id)}>{t('Withdraw', 'سحب')}</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Review Queue Tab */}
          <TabsContent value="review" className="mt-4">
            {loading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-700" />)}</div> : (
              <div className="space-y-3">
                {review.length === 0 && <Card className="bg-slate-800 border-slate-700"><CardContent className="p-8 text-center text-slate-400">{t('Review queue is empty', 'قائمة المراجعة فارغة')}</CardContent></Card>}
                {review.map(r => (
                  <Card key={r.id} className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => toggleExpand(r.id)} className="text-white font-medium hover:text-blue-300 flex items-center gap-1">
                              {expanded.has(r.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{r.titleEn}
                            </button>
                            <Badge variant="outline" className={`text-xs ${policyAreaBadge(r.policyArea)}`}>{r.policyArea}</Badge>
                          </div>
                          <p className="text-slate-400 text-xs mt-1">{t('Submitted', 'مُقدَّم')}: {fmtDate(r.submittedAt)} · {t('Maker', 'المُنشئ')}: {r.makerId ?? '—'}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 h-7 px-3" onClick={() => approve(r.id)}><CheckCircle className="w-3.5 h-3.5 me-1" />{t('Approve', 'موافقة')}</Button>
                          <Button size="sm" variant="outline" className="border-red-700 text-red-400 h-7 px-3" onClick={() => setRejectTarget(r)}><XCircle className="w-3.5 h-3.5 me-1" />{t('Reject', 'رفض')}</Button>
                        </div>
                      </div>
                      {expanded.has(r.id) && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-700">
                          <DiffBlock label={t('Before', 'قبل')} json={r.changeBeforeJson} />
                          <DiffBlock label={t('After', 'بعد')} json={r.changeAfterJson} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="mt-4">
            {loading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 bg-slate-700" />)}</div> : (
              <div className="space-y-3">
                {history.length === 0 && <Card className="bg-slate-800 border-slate-700"><CardContent className="p-8 text-center text-slate-400">{t('No history yet', 'لا يوجد سجل حتى الآن')}</CardContent></Card>}
                {history.map(r => (
                  <Card key={r.id} className="bg-slate-800 border-slate-700">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button onClick={() => toggleExpand(r.id)} className="text-white font-medium hover:text-blue-300 flex items-center gap-1">
                            {expanded.has(r.id) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{r.titleEn}
                          </button>
                          <Badge variant="outline" className={`text-xs ${policyAreaBadge(r.policyArea)}`}>{r.policyArea}</Badge>
                          <Badge variant="outline" className={`text-xs ${statusBadge(r.status)}`}>{r.status}</Badge>
                        </div>
                        {r.status === 'applied' && (
                          <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300 h-7" onClick={() => setRollbackTarget(r)}>
                            <RotateCcw className="w-3.5 h-3.5 me-1" />{t('Rollback', 'تراجع')}
                          </Button>
                        )}
                      </div>
                      <p className="text-slate-400 text-xs">{fmtDate(r.appliedAt ?? r.updatedAt)}</p>
                      {expanded.has(r.id) && (
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-700">
                          <DiffBlock label={t('Before', 'قبل')} json={r.changeBeforeJson} />
                          <DiffBlock label={t('After', 'بعد')} json={r.changeAfterJson} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <NewChangeDialog open={newChangeOpen} onClose={() => setNewChangeOpen(false)} onSaved={load} />
        <RejectDialog open={!!rejectTarget} onClose={() => setRejectTarget(null)} onConfirm={reason => rejectTarget && reject(rejectTarget.id, reason)} />

        <AlertDialog open={!!rollbackTarget} onOpenChange={v => !v && setRollbackTarget(null)}>
          <AlertDialogContent className="bg-slate-800 border-slate-700 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('Rollback Policy Change?', 'التراجع عن تغيير السياسة؟')}</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                {t('Rolling back', 'التراجع عن')} <strong className="text-white">{rollbackTarget?.titleEn}</strong>. {t('This action is audit-logged.', 'هذا الإجراء مسجل تدقيقياً.')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="px-1 pb-2">
              <Label>{t('Reason', 'السبب')}</Label>
              <Textarea className="mt-1 bg-slate-700 border-slate-600 h-20 resize-none" value={rollbackReason} onChange={e => setRollbackReason(e.target.value)} />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-slate-600">{t('Cancel', 'إلغاء')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => rollbackTarget && rollback(rollbackTarget.id)} className="bg-amber-600 hover:bg-amber-700">{t('Rollback', 'تراجع')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AnimatedPage>
  );
}
