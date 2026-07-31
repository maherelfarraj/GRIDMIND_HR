import { apiFetch } from '@/lib/api';
import React, { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { useToast } from '@/hooks/use-toast';
import {
  Server, Plus, AlertCircle, CheckCircle, XCircle, Activity, Copy, Clock, ShieldAlert, AlertTriangle, Info
} from 'lucide-react';

interface GatewayRegistration {
  id: number;
  name: string;
  nameAr: string | null;
  deviceId: number | null;
  adapterType: 'ZKTECO' | 'SUPREMA' | 'ZKTECO_NATIVE' | 'SUPREMA_NATIVE' | 'GENERIC_REST' | 'CSV' | 'SIMULATOR';
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: string | null;
  lastHeartbeatAt: string | null;
  clockDriftMs: number | null;
  driftAlert: boolean;
  deviceClockSkewMs: number | null;
  deviceClockSkewAlert: boolean;
  adapterConnStatus: 'REACHABLE' | 'AUTH_FAILED' | 'UNREACHABLE' | 'NOT_CONFIGURED' | null;
  adapterConnMessage: string | null;
  adapterConnTestedAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface ImportBatch {
  id: number;
  batchUuid: string;
  registrationId: number;
  source: string;
  receivedAt: string;
  eventCount: number;
  insertedCount: number;
  duplicateCount: number;
  errorCount: number;
  unmappedCount: number;
  rawPayloadSha256: string;
  signatureValid: boolean;
  clockDriftMs: number | null;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  errorSummary: string | null;
}

interface CreateRegistrationPayload {
  name: string;
  nameAr?: string;
  deviceId?: number;
  adapterType: 'ZKTECO' | 'SUPREMA' | 'ZKTECO_NATIVE' | 'SUPREMA_NATIVE' | 'GENERIC_REST' | 'CSV' | 'SIMULATOR';
  notes?: string;
}

interface CreateRegistrationResponse {
  registration: GatewayRegistration;
  secret: string;
}

interface ReconcileStatus {
  registrationId: number | null;
  registrationName: string | null;
  reconciledAt: string;
  checked: number;
  missing: string[];
  mismatched: string[];
}
export default function AttendanceGateway() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedRegistration, setSelectedRegistration] = useState<number | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);

  const [formData, setFormData] = useState<CreateRegistrationPayload>({
    name: '',
    nameAr: '',
    adapterType: 'GENERIC_REST',
    notes: '',
  });

  const { data: registrations, isLoading: loadingRegistrations } = useQuery<GatewayRegistration[]>({
    queryKey: ['gateway-registrations'],
    queryFn: () => apiFetch('/api/gateway/registrations', { credentials: 'include' }).then(r => r.json()),
  });

  const { data: batches, isLoading: loadingBatches } = useQuery<ImportBatch[]>({
    queryKey: ['gateway-batches', selectedRegistration],
    queryFn: () =>
      apiFetch(`/api/gateway/batches${selectedRegistration ? `?registrationId=${selectedRegistration}` : ''}`, { credentials: 'include' }).then(r => r.json()),
    enabled: !!selectedRegistration,
  });

  const { data: reconcileStatus } = useQuery<ReconcileStatus[]>({
    queryKey: ['gateway-reconcile-status'],
    queryFn: () => apiFetch('/api/gateway/reconcile-status', { credentials: 'include' }).then(r => r.json()),
  });

  const reconcileAlerts = (reconcileStatus ?? []).filter(s => s.missing.length > 0 || s.mismatched.length > 0);

  const createMutation = useMutation({
    mutationFn: async (payload: CreateRegistrationPayload) => {
      const res = await apiFetch('/api/gateway/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to create registration');
      return res.json() as Promise<CreateRegistrationResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['gateway-registrations'] });
      setOneTimeSecret(data.secret);
      setShowCreateDialog(false);
      setFormData({ name: '', nameAr: '', adapterType: 'GENERIC_REST', notes: '' });
      toast({
        title: t('Gateway Registered', 'تم تسجيل البوابة'),
        description: t('Gateway registration created successfully. Copy the secret now — it cannot be retrieved again.', 'تم إنشاء تسجيل البوابة بنجاح. انسخ السر الآن — لا يمكن استرجاعه مرة أخرى.'),
      });
    },
    onError: () => {
      toast({
        title: t('Error', 'خطأ'),
        description: t('Failed to create gateway registration.', 'فشل في إنشاء تسجيل البوابة.'),
        variant: 'destructive',
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiFetch(`/api/gateway/registrations/${id}/revoke`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to revoke');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gateway-registrations'] });
      toast({
        title: t('Gateway Revoked', 'تم إلغاء البوابة'),
        description: t('Gateway registration has been revoked.', 'تم إلغاء تسجيل البوابة.'),
      });
    },
    onError: () => {
      toast({
        title: t('Error', 'خطأ'),
        description: t('Failed to revoke gateway.', 'فشل في إلغاء البوابة.'),
        variant: 'destructive',
      });
    },
  });

  const handleCreate = () => {
    createMutation.mutate(formData);
  };

  const handleRevoke = (id: number) => {
    if (confirm(t('Are you sure you want to revoke this gateway? This action cannot be undone.', 'هل أنت متأكد من إلغاء هذه البوابة؟ لا يمكن التراجع عن هذا الإجراء.'))) {
      revokeMutation.mutate(id);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: t('Copied', 'تم النسخ'),
      description: t('Secret copied to clipboard', 'تم نسخ السر إلى الحافظة'),
    });
  };

  const getHealthIcon = (reg: GatewayRegistration) => {
    if (reg.status === 'REVOKED') return <XCircle className="w-4 h-4 text-muted-foreground" />;
    if (!reg.lastSeenAt) return <AlertCircle className="w-4 h-4 text-amber-500" />;

    const lastSeenMs = new Date().getTime() - new Date(reg.lastSeenAt).getTime();
    const minutes = lastSeenMs / 1000 / 60;
    if (minutes < 5) return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    if (minutes < 30) return <AlertCircle className="w-4 h-4 text-amber-500" />;
    return <XCircle className="w-4 h-4 text-rose-500" />;
  };

  const getHealthText = (reg: GatewayRegistration) => {
    if (reg.status === 'REVOKED') return t('Revoked', 'ملغى');
    if (!reg.lastSeenAt) return t('Never seen', 'لم يُشاهد أبدًا');

    const lastSeenMs = new Date().getTime() - new Date(reg.lastSeenAt).getTime();
    const minutes = Math.floor(lastSeenMs / 1000 / 60);
    if (minutes < 1) return t('Just now', 'الآن');
    if (minutes < 60) return t(`${minutes}m ago`, `منذ ${minutes} دقيقة`);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t(`${hours}h ago`, `منذ ${hours} ساعة`);
    const days = Math.floor(hours / 24);
    return t(`${days}d ago`, `منذ ${days} يوم`);
  };

  const getAdapterBadge = (adapter: string) => {
    const middlewareLabel =
      adapter === 'ZKTECO' ? t('via ZKBioTime', 'عبر ZKBioTime')
      : adapter === 'SUPREMA' ? t('via BioStar 2', 'عبر BioStar 2')
      : null;
    if (middlewareLabel) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {adapter}
          </Badge>
          <Badge variant="secondary" className="text-xs bg-sky-500/10 text-sky-500 border-sky-500/20">
            {middlewareLabel}
          </Badge>
        </div>
      );
    }
    return <Badge variant="outline" className="text-xs">{adapter}</Badge>;
  };

  const getConnectionBadge = (reg: GatewayRegistration) => {
    if (!reg.adapterConnStatus) {
      return <span className="text-xs text-muted-foreground">{t('No test yet', 'لا يوجد اختبار بعد')}</span>;
    }
    const conf: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
      REACHABLE: {
        cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        icon: <CheckCircle className="w-3 h-3" />,
        label: t('Reachable', 'يمكن الوصول'),
      },
      AUTH_FAILED: {
        cls: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
        icon: <ShieldAlert className="w-3 h-3" />,
        label: t('Auth failed', 'فشل المصادقة'),
      },
      UNREACHABLE: {
        cls: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
        icon: <XCircle className="w-3 h-3" />,
        label: t('Unreachable', 'تعذر الوصول'),
      },
      NOT_CONFIGURED: {
        cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
        icon: <AlertCircle className="w-3 h-3" />,
        label: t('Not configured', 'غير مُهيأ'),
      },
    };
    const c = conf[reg.adapterConnStatus];
    return (
      <div className="space-y-1" title={reg.adapterConnMessage ?? undefined}>
        <Badge variant="outline" className={`text-xs gap-1 ${c.cls}`}>
          {c.icon}
          {c.label}
        </Badge>
        {reg.adapterConnTestedAt && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            {formatDateTime(reg.adapterConnTestedAt)}
          </div>
        )}
        {reg.adapterConnStatus !== 'REACHABLE' && reg.adapterConnMessage && (
          <div className="text-[11px] text-muted-foreground max-w-[220px] truncate">{reg.adapterConnMessage}</div>
        )}
      </div>
    );
  };

  const getBatchStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      COMPLETED: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
      PARTIAL: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
      FAILED: 'bg-rose-500/10 text-rose-500 border-rose-500/20',
    };
    return (
      <Badge variant="outline" className={`text-xs ${colors[status] ?? ''}`}>
        {status}
      </Badge>
    );
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <AnimatedPage className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Attendance Gateway', 'بوابة الحضور')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage local gateway registrations and import batches.', 'إدارة تسجيلات البوابات المحلية ودفعات الاستيراد.')}
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 me-2" />
          {t('Register Gateway', 'تسجيل بوابة')}
        </Button>
      </div>

      {/* SDK Notice */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-blue-500 mb-1">
              {t('Adapter Types', 'أنواع المحولات')}
            </p>
            <p className="text-muted-foreground">
              {t(
                'ZKTECO connects through the ZKBioTime/BioTime middleware REST API (set ZKTECO_API_URL, ZKTECO_USERNAME, ZKTECO_PASSWORD on the gateway host). SUPREMA connects through the BioStar 2 server REST API (set SUPREMA_API_URL, SUPREMA_LOGIN_ID, SUPREMA_PASSWORD). GENERIC_REST, CSV, and SIMULATOR are also fully operational. Native device protocols (ZKTeco PUSH, BioStar SDK) remain an optional on-site path requiring the licensed vendor SDK and physical hardware.',
                'يتصل ZKTECO عبر واجهة REST لوسيط ZKBioTime/BioTime (اضبط ZKTECO_API_URL و ZKTECO_USERNAME و ZKTECO_PASSWORD على مضيف البوابة). يتصل SUPREMA عبر واجهة REST لخادم BioStar 2 (اضبط SUPREMA_API_URL و SUPREMA_LOGIN_ID و SUPREMA_PASSWORD). كما تعمل GENERIC_REST و CSV و SIMULATOR بالكامل. تبقى بروتوكولات الأجهزة الأصلية مسارًا اختياريًا في الموقع يتطلب SDK مرخصًا وأجهزة فعلية.'
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Reconciliation warning: gateway-reported batches missing on the server */}
      {reconcileAlerts.length > 0 && (
        <Card className="bg-rose-500/5 border-rose-500/20">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm space-y-2">
              <p className="font-semibold text-rose-500">
                {t('Punch batches missing on server', 'دفعات بصمات مفقودة على الخادم')}
              </p>
              <p className="text-muted-foreground">
                {t(
                  'The last reconciliation found batches a gateway believes it delivered but the server never received. Check the gateway\'s local status API for terminal batches and requeue them once the underlying failure is fixed.',
                  'وجدت آخر عملية مطابقة دفعات تعتقد البوابة أنها سلمتها لكن الخادم لم يستلمها. تحقق من واجهة الحالة المحلية للبوابة بحثًا عن الدفعات المتوقفة وأعد إرسالها بعد إصلاح سبب الفشل.',
                )}
              </p>
              {reconcileAlerts.map(alert => (
                <div key={alert.registrationId ?? alert.registrationName ?? 'unknown'} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{alert.registrationName ?? `#${alert.registrationId}`}</span>
                  {' — '}
                  {alert.missing.length > 0 && (
                    <span>
                      {t(`${alert.missing.length} missing`, `${alert.missing.length} مفقودة`)}
                      {': '}
                      <code className="font-mono break-all">{alert.missing.join(', ')}</code>
                    </span>
                  )}
                  {alert.missing.length > 0 && alert.mismatched.length > 0 && '; '}
                  {alert.mismatched.length > 0 && (
                    <span>
                      {t(`${alert.mismatched.length} count mismatch`, `${alert.mismatched.length} عدم تطابق العدد`)}
                      {': '}
                      <code className="font-mono break-all">{alert.mismatched.join(', ')}</code>
                    </span>
                  )}
                  {' ('}{formatDateTime(alert.reconciledAt)}{')'}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Registrations Table */}
      <Card>
        <CardHeader>
          <CardTitle>{t('Gateway Registrations', 'تسجيلات البوابات')}</CardTitle>
          <CardDescription>
            {t('Local services that forward biometric punches over HMAC-signed requests.', 'الخدمات المحلية التي تُرسل بصمات البيومترية عبر طلبات موقعة بـ HMAC.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>{t('Name', 'الاسم')}</TableHead>
                <TableHead>{t('Adapter', 'المحول')}</TableHead>
                <TableHead>{t('Status', 'الحالة')}</TableHead>
                <TableHead>{t('Health', 'الصحة')}</TableHead>
                <TableHead>{t('Connection', 'الاتصال')}</TableHead>
                <TableHead>{t('Clock Drift', 'انحراف الساعة')}</TableHead>
                <TableHead>{t('Device Clock', 'ساعة الجهاز')}</TableHead>
                <TableHead>{t('Created', 'تم الإنشاء')}</TableHead>
                <TableHead className="text-center">{t('Actions', 'إجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRegistrations ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : !registrations || registrations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    <Server className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    {t('No gateway registrations found.', 'لا توجد تسجيلات بوابات.')}
                  </TableCell>
                </TableRow>
              ) : (
                registrations.map(reg => (
                  <TableRow
                    key={reg.id}
                    className={`cursor-pointer hover:bg-muted/50 ${selectedRegistration === reg.id ? 'bg-primary/5' : ''}`}
                    onClick={() => setSelectedRegistration(reg.id)}
                  >
                    <TableCell className="font-medium">
                      <div>
                        <div>{lang === 'en' ? reg.name : (reg.nameAr || reg.name)}</div>
                        {reg.notes && (
                          <div className="text-xs text-muted-foreground mt-1">{reg.notes}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getAdapterBadge(reg.adapterType)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={reg.status === 'ACTIVE' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {reg.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getHealthIcon(reg)}
                        <span className="text-sm">{getHealthText(reg)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getConnectionBadge(reg)}
                    </TableCell>
                    <TableCell>
                      {reg.driftAlert ? (
                        <div className="flex items-center gap-1 text-rose-500">
                          <AlertTriangle className="w-3 h-3" />
                          <span className="text-xs font-semibold">
                            {reg.clockDriftMs != null ? `${Math.abs(reg.clockDriftMs)}ms` : '-'}
                          </span>
                        </div>
                      ) : reg.clockDriftMs != null ? (
                        <span className="text-xs text-muted-foreground">{Math.abs(reg.clockDriftMs)}ms</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {reg.deviceClockSkewAlert ? (
                        <div
                          className="flex items-center gap-1 text-rose-500"
                          title={t('Device clock skew exceeds 60s — fix the device clock', 'انحراف ساعة الجهاز يتجاوز 60 ثانية — يجب ضبط ساعة الجهاز')}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span className="text-xs font-semibold">
                            {reg.deviceClockSkewMs != null ? `${Math.round(reg.deviceClockSkewMs / 1000)}s` : '-'}
                          </span>
                        </div>
                      ) : reg.deviceClockSkewMs != null ? (
                        <span className="text-xs text-muted-foreground">{(reg.deviceClockSkewMs / 1000).toFixed(1)}s</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(reg.createdAt)}
                    </TableCell>
                    <TableCell className="text-center">
                      {reg.status === 'ACTIVE' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive h-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRevoke(reg.id);
                          }}
                        >
                          {t('Revoke', 'إلغاء')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Import Batches */}
      {selectedRegistration && (
        <Card>
          <CardHeader>
            <CardTitle>{t('Import Batches', 'دفعات الاستيراد')}</CardTitle>
            <CardDescription>
              {t('Historical ingestion logs for the selected gateway.', 'سجلات الاستيعاب التاريخية للبوابة المحددة.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>{t('Received', 'تم الاستلام')}</TableHead>
                  <TableHead>{t('Source', 'المصدر')}</TableHead>
                  <TableHead className="text-center">{t('Events', 'أحداث')}</TableHead>
                  <TableHead className="text-center">{t('Inserted', 'مُدرج')}</TableHead>
                  <TableHead className="text-center">{t('Duplicates', 'مكررات')}</TableHead>
                  <TableHead className="text-center">{t('Errors', 'أخطاء')}</TableHead>
                  <TableHead className="text-center">{t('Unmapped', 'غير معين')}</TableHead>
                  <TableHead>{t('Status', 'الحالة')}</TableHead>
                  <TableHead className="text-center">{t('Signature', 'التوقيع')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingBatches ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12 mx-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16 mx-auto" /></TableCell>
                    </TableRow>
                  ))
                ) : !batches || batches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      <Activity className="w-8 h-8 mx-auto mb-3 opacity-20" />
                      {t('No import batches found.', 'لا توجد دفعات استيراد.')}
                    </TableCell>
                  </TableRow>
                ) : (
                  batches.map(batch => (
                    <TableRow key={batch.id}>
                      <TableCell className="text-sm font-mono">
                        {formatDateTime(batch.receivedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {batch.source}
                      </TableCell>
                      <TableCell className="text-center font-semibold">
                        {batch.eventCount}
                      </TableCell>
                      <TableCell className="text-center text-emerald-500 font-semibold">
                        {batch.insertedCount}
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {batch.duplicateCount}
                      </TableCell>
                      <TableCell className="text-center">
                        {batch.errorCount > 0 ? (
                          <span className="text-rose-500 font-semibold">{batch.errorCount}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {batch.unmappedCount > 0 ? (
                          <span className="text-amber-500 font-semibold">{batch.unmappedCount}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {getBatchStatusBadge(batch.status)}
                      </TableCell>
                      <TableCell className="text-center">
                        {batch.signatureValid ? (
                          <CheckCircle className="w-4 h-4 text-emerald-500 mx-auto" />
                        ) : (
                          <ShieldAlert className="w-4 h-4 text-rose-500 mx-auto" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Register New Gateway', 'تسجيل بوابة جديدة')}</DialogTitle>
            <DialogDescription>
              {t('Create a new gateway registration and receive a one-time secret.', 'إنشاء تسجيل بوابة جديد واستلام سر لمرة واحدة.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name">{t('Name (English)', 'الاسم (إنجليزي)')}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('e.g. Main Office Gateway', 'مثال: بوابة المكتب الرئيسي')}
              />
            </div>

            <div>
              <Label htmlFor="nameAr">{t('Name (Arabic)', 'الاسم (عربي)')}</Label>
              <Input
                id="nameAr"
                value={formData.nameAr}
                onChange={e => setFormData({ ...formData, nameAr: e.target.value })}
                placeholder={t('Optional Arabic name', 'اسم عربي اختياري')}
              />
            </div>

            <div>
              <Label htmlFor="adapterType">{t('Adapter Type', 'نوع المحول')}</Label>
              <Select
                value={formData.adapterType}
                onValueChange={(value) => setFormData({ ...formData, adapterType: value as any })}
              >
                <SelectTrigger id="adapterType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GENERIC_REST">GENERIC_REST</SelectItem>
                  <SelectItem value="CSV">CSV</SelectItem>
                  <SelectItem value="SIMULATOR">SIMULATOR</SelectItem>
                  <SelectItem value="ZKTECO">ZKTECO (ZKBioTime middleware)</SelectItem>
                  <SelectItem value="SUPREMA">SUPREMA (BioStar 2 middleware)</SelectItem>
                  <SelectItem value="ZKTECO_NATIVE">ZKTECO_NATIVE (on-site PUSH protocol)</SelectItem>
                  <SelectItem value="SUPREMA_NATIVE">SUPREMA_NATIVE (on-site BioStar SDK)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="deviceId">{t('Device ID (optional)', 'معرف الجهاز (اختياري)')}</Label>
              <Input
                id="deviceId"
                type="number"
                value={formData.deviceId ?? ''}
                onChange={e => setFormData({ ...formData, deviceId: e.target.value ? Number(e.target.value) : undefined })}
                placeholder={t('Link to existing device', 'ربط بجهاز موجود')}
              />
            </div>

            <div>
              <Label htmlFor="notes">{t('Notes', 'ملاحظات')}</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                placeholder={t('Optional notes', 'ملاحظات اختيارية')}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button onClick={handleCreate} disabled={!formData.name || createMutation.isPending}>
              {createMutation.isPending ? t('Creating...', 'جارٍ الإنشاء...') : t('Create', 'إنشاء')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-Time Secret Dialog */}
      <Dialog open={!!oneTimeSecret} onOpenChange={(open) => !open && setOneTimeSecret(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-500">
              <AlertCircle className="w-5 h-5" />
              {t('One-Time Secret', 'سر لمرة واحدة')}
            </DialogTitle>
            <DialogDescription>
              {t('Copy this secret now. It cannot be retrieved again after you close this dialog.', 'انسخ هذا السر الآن. لا يمكن استرجاعه مرة أخرى بعد إغلاق هذه النافذة.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-md border-2 border-rose-500/20">
              <div className="flex items-center justify-between gap-3">
                <code className="text-sm font-mono break-all flex-1">{oneTimeSecret}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => oneTimeSecret && copyToClipboard(oneTimeSecret)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-500">
                {t('Warning: This secret will not be shown again. Store it securely in your gateway configuration.', 'تحذير: لن يتم عرض هذا السر مرة أخرى. احفظه بشكل آمن في إعدادات البوابة.')}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setOneTimeSecret(null)}>
              {t('I have copied the secret', 'لقد نسخت السر')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
