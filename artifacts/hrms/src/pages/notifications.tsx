import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  useListNotifications,
  useUpdateNotification,
  useMarkAllNotificationsRead,
  useListEscalationRules,
  useCreateEscalationRule,
  useUpdateEscalationRule,
} from '@workspace/api-client-react';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Bell, Info, AlertTriangle, AlertOctagon, X,
  Plus, CheckCheck, Clock, ExternalLink,
} from 'lucide-react';

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(d: string | null | undefined): string {
  if (!d) return '—';
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function severityIcon(severity: string) {
  if (severity === 'info')    return <Info className="w-5 h-5 text-blue-400 shrink-0" />;
  if (severity === 'warning') return <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />;
  if (severity === 'error')   return <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />;
  if (severity === 'urgent')  return <AlertOctagon className="w-5 h-5 text-red-500 animate-pulse shrink-0" />;
  return <Bell className="w-5 h-5 text-slate-400 shrink-0" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    info:    'bg-blue-100 text-blue-700 border-blue-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    error:   'bg-red-100 text-red-700 border-red-200',
    urgent:  'bg-red-200 text-red-800 border-red-300',
  };
  return (
    <Badge variant="outline" className={cn('capitalize text-xs', map[severity] ?? '')}>
      {severity}
    </Badge>
  );
}

// ── Inbox Tab ─────────────────────────────────────────────────────────────────

function InboxTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const [typeFilter, setTypeFilter]       = useState('all');
  const [readFilter, setReadFilter]       = useState<'all' | 'unread' | 'read'>('all');
  const [actionFilter, setActionFilter]   = useState(false);
  const [dismissing, setDismissing]       = useState<number | null>(null);

  const { data: notifs, isLoading } = useListNotifications(undefined as any);
  const updateMut   = useUpdateNotification();
  const markAllMut  = useMarkAllNotificationsRead();

  const allNotifs = notifs ?? [];

  const unreadCount = useMemo(() => allNotifs.filter(n => !(n as any).isRead).length, [allNotifs]);

  const types = useMemo(
    () => [...new Set(allNotifs.map(n => (n as any).notificationType).filter(Boolean))],
    [allNotifs]
  );

  const filtered = useMemo(() => {
    return allNotifs.filter(n => {
      const nn = n as any;
      if (typeFilter !== 'all' && nn.notificationType !== typeFilter) return false;
      if (readFilter === 'unread' && nn.isRead) return false;
      if (readFilter === 'read'   && !nn.isRead) return false;
      if (actionFilter && !nn.requiresAction) return false;
      return true;
    });
  }, [allNotifs, typeFilter, readFilter, actionFilter]);

  async function handleRead(id: number) {
    try {
      await updateMut.mutateAsync({ id, data: { isRead: true } as any });
      qc.invalidateQueries({ queryKey: ['/api/notifications'] });
    } catch { /* silent */ }
  }

  async function handleDismiss(id: number) {
    setDismissing(id);
    try {
      await updateMut.mutateAsync({ id, data: { isDismissed: true } as any });
      qc.invalidateQueries({ queryKey: ['/api/notifications'] });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setDismissing(null);
    }
  }

  async function handleMarkAll() {
    try {
      await markAllMut.mutateAsync();
      qc.invalidateQueries({ queryKey: ['/api/notifications'] });
      toast({ title: t('All marked as read', 'تم تعليم الكل كمقروء') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    }
  }

  async function handleCardClick(n: any) {
    if (!n.isRead) await handleRead(n.id);
    if (n.actionUrl) navigate(n.actionUrl);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-semibold">{t('Inbox', 'صندوق الوارد')}</h3>
          {unreadCount > 0 && (
            <Badge className="bg-amber-500 text-slate-900 font-bold">{unreadCount}</Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-slate-600 text-slate-300 hover:text-white"
          onClick={handleMarkAll}
        >
          <CheckCheck className="w-4 h-4 mr-1" />
          {t('Mark All Read', 'تعليم الكل كمقروء')}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48 bg-slate-800 border-slate-700 text-white">
            <SelectValue placeholder={t('All Types', 'كل الأنواع')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Types', 'كل الأنواع')}</SelectItem>
            {types.map(tp => (
              <SelectItem key={tp} value={tp} className="capitalize">{tp.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={readFilter} onValueChange={v => setReadFilter(v as 'all' | 'unread' | 'read')}>
          <SelectTrigger className="w-36 bg-slate-800 border-slate-700 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All', 'الكل')}</SelectItem>
            <SelectItem value="unread">{t('Unread', 'غير مقروء')}</SelectItem>
            <SelectItem value="read">{t('Read', 'مقروء')}</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <Switch checked={actionFilter} onCheckedChange={setActionFilter} />
          {t('Requires Action', 'يتطلب إجراء')}
        </label>
      </div>

      {/* Notification Cards */}
      <div className="space-y-2">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="bg-slate-800 border-slate-700">
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-4 w-3/4 bg-slate-700" />
                  <Skeleton className="h-3 w-full bg-slate-700" />
                </CardContent>
              </Card>
            ))
          : filtered.map(notif => {
              const n = notif as any;
              const isUnread = !n.isRead;
              return (
                <Card
                  key={n.id}
                  className={cn(
                    'bg-slate-800 border-slate-700 cursor-pointer transition-colors hover:bg-slate-750 hover:border-slate-600',
                    isUnread && 'border-l-2 border-l-amber-500'
                  )}
                  onClick={() => handleCardClick(n)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {severityIcon(n.severity ?? 'info')}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className={cn('text-sm font-medium', isUnread ? 'text-white' : 'text-slate-300')}>
                              {n.titleEn ?? n.title}
                            </p>
                            {isUnread && (
                              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                            )}
                            {n.requiresAction && (
                              <Badge className="text-xs bg-red-900/50 text-red-300 border border-red-700/50">
                                {t('Action Required', 'إجراء مطلوب')}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-xs text-slate-500">{timeAgo(n.createdAt)}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-slate-500 hover:text-slate-300"
                              disabled={dismissing === n.id}
                              onClick={e => { e.stopPropagation(); handleDismiss(n.id); }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                          {n.bodyEn ?? n.body ?? n.messageEn ?? ''}
                        </p>
                        {n.actionUrl && (
                          <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-400">
                            <ExternalLink className="w-3 h-3" />
                            {n.actionUrl}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>{t('No notifications', 'لا توجد إشعارات')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Escalation Rules Tab ──────────────────────────────────────────────────────

function EscalationRulesTab() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);

  const { data: rules, isLoading } = useListEscalationRules(undefined as any);
  const updateRule = useUpdateEscalationRule();

  const allRules = rules ?? [];

  async function handleToggleActive(id: number, current: boolean) {
    try {
      await updateRule.mutateAsync({ id, data: { isActive: !current } as any });
      qc.invalidateQueries({ queryKey: ['/api/escalation-rules'] });
      toast({ title: t('Updated', 'تم التحديث') });
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          onClick={() => setNewOpen(true)}
        >
          <Plus className="w-4 h-4 mr-1" />
          {t('New Rule', 'قاعدة جديدة')}
        </Button>
      </div>
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700">
                <TableHead className="text-slate-400">{t('Name', 'الاسم')}</TableHead>
                <TableHead className="text-slate-400">{t('Entity Type', 'نوع الكيان')}</TableHead>
                <TableHead className="text-slate-400">{t('Trigger Status', 'حالة التشغيل')}</TableHead>
                <TableHead className="text-slate-400">{t('Escalate After', 'التصعيد بعد')}</TableHead>
                <TableHead className="text-slate-400">{t('Escalate To Role', 'التصعيد لدور')}</TableHead>
                <TableHead className="text-slate-400">{t('Severity', 'الخطورة')}</TableHead>
                <TableHead className="text-slate-400">{t('Active', 'نشط')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-700">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full bg-slate-700" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                : allRules.map(rule => {
                    const r = rule as any;
                    return (
                      <TableRow key={r.id} className="border-slate-700 hover:bg-slate-700/40">
                        <TableCell className="text-white font-medium">{r.nameEn ?? r.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 capitalize">
                            {r.entityType?.replace(/_/g, ' ') ?? '—'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm capitalize">
                          {r.triggerStatus?.replace(/_/g, ' ') ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">
                          {r.escalateAfterHours != null ? `${r.escalateAfterHours}h` : '—'}
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm capitalize">
                          {r.escalateToRole?.replace(/_/g, ' ') ?? '—'}
                        </TableCell>
                        <TableCell><SeverityBadge severity={r.severity ?? 'info'} /></TableCell>
                        <TableCell>
                          <Switch
                            checked={!!r.isActive}
                            onCheckedChange={() => handleToggleActive(r.id, !!r.isActive)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              {!isLoading && allRules.length === 0 && (
                <TableRow className="border-slate-700">
                  <TableCell colSpan={7} className="text-center py-10 text-slate-500">
                    {t('No escalation rules found', 'لا توجد قواعد تصعيد')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <NewEscalationRuleDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function NewEscalationRuleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createRule = useCreateEscalationRule();

  const [form, setForm] = useState({
    nameEn: '', entityType: 'leave_request', triggerStatus: 'submitted',
    escalateAfterHours: '24', escalateToRole: 'hr_manager', severity: 'warning',
    isActive: true,
  });
  const [saving, setSaving] = useState(false);

  function setF(k: string, v: string | boolean) { setForm(p => ({ ...p, [k]: v })); }

  async function handleSave() {
    if (!form.nameEn) {
      toast({ title: t('Name required', 'الاسم مطلوب'), variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await createRule.mutateAsync({
        data: {
          ...form,
          escalateAfterHours: Number(form.escalateAfterHours),
        } as any,
      });
      qc.invalidateQueries({ queryKey: ['/api/escalation-rules'] });
      toast({ title: t('Rule created', 'تم إنشاء القاعدة') });
      onClose();
    } catch (e: any) {
      toast({ title: t('Error', 'خطأ'), description: e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('New Escalation Rule', 'قاعدة تصعيد جديدة')}</DialogTitle>
          <DialogDescription>{t('Configure automatic escalation', 'تكوين التصعيد التلقائي')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Rule Name', 'اسم القاعدة')}</label>
            <Input value={form.nameEn} onChange={e => setF('nameEn', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Entity Type', 'نوع الكيان')}</label>
              <Select value={form.entityType} onValueChange={v => setF('entityType', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['leave_request','payroll_run','document','approval','onboarding_task'].map(e => (
                    <SelectItem key={e} value={e} className="capitalize">{e.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Trigger Status', 'حالة التشغيل')}</label>
              <Input
                value={form.triggerStatus}
                onChange={e => setF('triggerStatus', e.target.value)}
                placeholder="submitted"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Escalate After (hours)', 'التصعيد بعد (ساعات)')}</label>
              <Input type="number" value={form.escalateAfterHours} onChange={e => setF('escalateAfterHours', e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t('Escalate To Role', 'التصعيد لدور')}</label>
              <Input value={form.escalateToRole} onChange={e => setF('escalateToRole', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">{t('Severity', 'الخطورة')}</label>
            <Select value={form.severity} onValueChange={v => setF('severity', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['info','warning','error','urgent'].map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={form.isActive} onCheckedChange={v => setF('isActive', v)} />
            {t('Active', 'نشط')}
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel', 'إلغاء')}</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold"
          >
            {saving ? t('Saving…', 'جاري الحفظ…') : t('Create', 'إنشاء')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Notifications() {
  const { t } = useLanguage();
  const { data: notifs } = useListNotifications(undefined as any);
  const unread = (notifs ?? []).filter(n => !(n as any).isRead).length;

  return (
    <AnimatedPage>
      <div className="p-6 space-y-6 bg-slate-900 min-h-screen">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Bell className="w-7 h-7 text-amber-400" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{t('Notifications', 'الإشعارات')}</h1>
            <p className="text-slate-400 text-sm">{t('Manage notifications and escalation rules', 'إدارة الإشعارات وقواعد التصعيد')}</p>
          </div>
        </div>

        <Tabs defaultValue="inbox">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="inbox" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Bell className="w-4 h-4 mr-1" />
              {t('Inbox', 'صندوق الوارد')}
              {unread > 0 && (
                <span className="ml-1 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                  {unread}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="escalation" className="data-[state=active]:bg-amber-500 data-[state=active]:text-slate-900">
              <Clock className="w-4 h-4 mr-1" />
              {t('Escalation Rules', 'قواعد التصعيد')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inbox" className="mt-4">
            <InboxTab />
          </TabsContent>
          <TabsContent value="escalation" className="mt-4">
            <EscalationRulesTab />
          </TabsContent>
        </Tabs>
      </div>
    </AnimatedPage>
  );
}
