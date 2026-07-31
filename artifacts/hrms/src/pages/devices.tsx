import { apiFetch } from '@/lib/api';
import { fetchGatewayRegistrations, selectOfflineGateways, type GatewayRegistration } from '@/lib/gateways';
import { useEffect, useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import {
  useListDevices,
  useGetDevice,
  useGetDeviceHealth,
  useCreateDevice,
  useUpdateDevice,
  getListDevicesQueryKey,
  getGetDeviceQueryKey,
  getGetDeviceHealthQueryKey,
  type AttendanceDeviceInput,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Cpu, Wifi, WifiOff, AlertCircle, Plus, Settings, Clock, CheckCircle, XCircle, Activity } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DeviceMapping {
  deviceId: number;
  employeeId: number;
  employeeNameEn: string;
  isActive: boolean;
}

const emptyDeviceForm: AttendanceDeviceInput = {
  name: '',
  serialNumber: '',
  model: '',
  vendor: '',
  type: 'fingerprint',
  ipAddress: '',
  location: '',
  locationAr: '',
  status: 'offline',
  firmwareVersion: '',
  integrationProtocol: 'TCP/IP',
};

export default function Devices() {
  const { t, lang } = useLanguage();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: devices, isLoading } = useListDevices();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [mappings, setMappings] = useState<DeviceMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [gateways, setGateways] = useState<GatewayRegistration[] | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState<AttendanceDeviceInput>(emptyDeviceForm);
  const [editForm, setEditForm] = useState({ name: '', ipAddress: '', location: '', locationAr: '', firmwareVersion: '', notes: '' });

  const invalidateDevices = (id?: number) => {
    queryClient.invalidateQueries({ queryKey: getListDevicesQueryKey() });
    if (id) {
      queryClient.invalidateQueries({ queryKey: getGetDeviceQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetDeviceHealthQueryKey(id) });
    }
  };

  const createDevice = useCreateDevice({
    mutation: {
      onSuccess: () => {
        invalidateDevices();
        setRegisterOpen(false);
        setRegisterForm(emptyDeviceForm);
        toast({ title: t('Device registered', 'تم تسجيل الجهاز'), description: t('The device was added to the fleet.', 'تمت إضافة الجهاز إلى الأسطول.') });
      },
      onError: () => {
        toast({ variant: 'destructive', title: t('Registration failed', 'فشل التسجيل'), description: t('Could not register the device. Check the fields and try again.', 'تعذر تسجيل الجهاز. تحقق من الحقول وحاول مرة أخرى.') });
      },
    },
  });

  const updateDevice = useUpdateDevice({
    mutation: {
      onSuccess: (_data, vars) => {
        invalidateDevices(vars.id);
        setEditOpen(false);
        setConfirmStatusOpen(false);
        toast({ title: t('Device updated', 'تم تحديث الجهاز') });
      },
      onError: () => {
        toast({ variant: 'destructive', title: t('Update failed', 'فشل التحديث'), description: t('Could not update the device. Please try again.', 'تعذر تحديث الجهاز. حاول مرة أخرى.') });
      },
    },
  });

  useEffect(() => {
    let cancelled = false;
    // Optional probe: the endpoint requires an authenticated session even in
    // demo mode — a 401 resolves to null (banner hidden), never a redirect.
    fetchGatewayRegistrations().then(data => {
      if (!cancelled) setGateways(data);
    });
    return () => { cancelled = true; };
  }, []);

  const offlineGateways = selectOfflineGateways(gateways);

  const { data: deviceDetail } = useGetDevice(selectedId || 0, { 
    query: { 
      enabled: !!selectedId, 
      queryKey: getGetDeviceQueryKey(selectedId || 0) 
    } 
  });

  const { data: deviceHealth } = useGetDeviceHealth(selectedId || 0, { 
    query: { 
      enabled: !!selectedId, 
      queryKey: getGetDeviceHealthQueryKey(selectedId || 0) 
    } 
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': return <Wifi className="w-4 h-4 text-emerald-500" />;
      case 'offline': return <WifiOff className="w-4 h-4 text-muted-foreground" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-destructive" />;
      default: return <Cpu className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const filteredDevices = devices?.filter(d => {
    if (filterStatus === 'all') return true;
    return d.status === filterStatus;
  });

  const handleDeviceSelect = async (id: number) => {
    setSelectedId(id);
    setLoadingMappings(true);
    try {
      const res = await apiFetch(`/api/device-mappings?deviceId=${id}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMappings(data);
      }
    } catch (error) {
      console.error('Failed to fetch mappings', error);
    } finally {
      setLoadingMappings(false);
    }
  };

  return (
    <AnimatedPage className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Biometric Devices', 'أجهزة البصمة')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Manage attendance hardware and SDK integrations.', 'إدارة أجهزة الحضور وتكامل أدوات التطوير.')}
          </p>
        </div>
        <Button onClick={() => setRegisterOpen(true)} data-testid="button-register-device">
          <Plus className="w-4 h-4 me-2" />
          {t('Register Device', 'تسجيل جهاز')}
        </Button>
      </div>

      {/* All gateways online — subtle confirmation (mirrors readiness.tsx) */}
      {gateways && offlineGateways.length === 0 && (() => {
        const active = gateways.filter(g => g.status === 'ACTIVE');
        return (
          <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-gateways-online">
            <Wifi className="w-4 h-4 text-emerald-500" />
            {active.length > 0
              ? t(`All ${active.length} attendance gateway(s) online`, `جميع بوابات الحضور (${active.length}) متصلة`)
              : t('No active attendance gateways registered', 'لا توجد بوابات حضور نشطة مسجلة')}
          </div>
        );
      })()}

      {/* Offline attendance gateways (silent = no heartbeat within threshold) */}
      {offlineGateways.length > 0 && (
        <Card className="border-destructive/60 bg-destructive/5" data-testid="card-offline-gateways">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-destructive text-base">
              <WifiOff className="w-5 h-5 shrink-0" />
              {t(
                `${offlineGateways.length} attendance gateway(s) OFFLINE — no heartbeat within threshold`,
                `${offlineGateways.length} بوابة حضور غير متصلة — لا نبضات ضمن الحد المسموح`
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {offlineGateways.map(g => {
              const lastContact = g.lastHeartbeatAt ?? g.lastSeenAt;
              return (
                <div key={g.id} className="flex items-center justify-between gap-3 flex-wrap text-sm" data-testid={`row-offline-gateway-${g.id}`}>
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs">
                      {t('Offline', 'غير متصل')}
                    </Badge>
                    <span className="font-medium">{lang === 'ar' && g.nameAr ? g.nameAr : g.name}</span>
                    {g.adapterType && <span className="text-xs text-muted-foreground font-mono">{g.adapterType}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t('Last contact: ', 'آخر اتصال: ')}
                    {lastContact
                      ? new Date(lastContact).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')
                      : t('never', 'أبدًا')}
                  </span>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground pt-2 border-t border-destructive/20">
              {t(
                `A gateway is considered offline after ${Math.round((offlineGateways[0]?.silenceThresholdMs ?? 0) / 60000)} minutes without a heartbeat. Check the site's gateway service and network.`,
                `تُعتبر البوابة غير متصلة بعد ${Math.round((offlineGateways[0]?.silenceThresholdMs ?? 0) / 60000)} دقيقة بدون نبضات. تحقق من خدمة البوابة والشبكة في الموقع.`
              )}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Device List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('Device Fleet', 'أسطول الأجهزة')}</CardTitle>
            <div className="flex gap-2 mt-3">
              <Button 
                variant={filterStatus === 'all' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setFilterStatus('all')}
              >
                {t('All', 'الكل')}
              </Button>
              <Button 
                variant={filterStatus === 'online' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setFilterStatus('online')}
              >
                {t('Online', 'متصل')}
              </Button>
              <Button 
                variant={filterStatus === 'offline' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setFilterStatus('offline')}
              >
                {t('Offline', 'غير متصل')}
              </Button>
              <Button 
                variant={filterStatus === 'error' ? 'default' : 'outline'} 
                size="sm"
                onClick={() => setFilterStatus('error')}
              >
                {t('Error', 'خطأ')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))
            ) : !filteredDevices || filteredDevices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                {t('No devices found.', 'لا توجد أجهزة.')}
              </div>
            ) : (
              filteredDevices.map((device) => (
                <div
                  key={device.id}
                  className={`p-3 rounded-md border cursor-pointer transition-all ${
                    selectedId === device.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border hover:bg-muted/50'
                  }`}
                  onClick={() => handleDeviceSelect(device.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(device.status)}
                      <span className="font-semibold text-sm">{device.name}</span>
                    </div>
                    <Badge 
                      variant={device.status === 'online' ? 'default' : 'secondary'}
                      className="capitalize text-xs"
                    >
                      {device.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {lang === 'en' ? device.location : device.locationAr}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono mt-1">
                    {device.vendor} {device.model}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('Last sync', 'آخر مزامنة')}: {device.lastSyncAt ? new Date(device.lastSyncAt).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Detail Panel */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('Device Details', 'تفاصيل الجهاز')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedId ? (
              <div className="text-center py-16 text-muted-foreground">
                <Cpu className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">{t('Select a device to view details', 'اختر جهازًا لعرض التفاصيل')}</p>
              </div>
            ) : !deviceDetail ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <div className="space-y-6">
                {/* Header Actions */}
                <div className="flex items-center justify-between pb-4 border-b">
                  <div>
                    <h3 className="text-xl font-semibold">{deviceDetail.name}</h3>
                    <p className="text-sm text-muted-foreground">{lang === 'en' ? deviceDetail.location : deviceDetail.locationAr}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-edit-device"
                      onClick={() => {
                        setEditForm({
                          name: deviceDetail.name,
                          ipAddress: deviceDetail.ipAddress ?? '',
                          location: deviceDetail.location,
                          locationAr: deviceDetail.locationAr,
                          firmwareVersion: deviceDetail.firmwareVersion ?? '',
                          notes: deviceDetail.notes ?? '',
                        });
                        setEditOpen(true);
                      }}
                    >
                      <Settings className="w-4 h-4 me-2" />
                      {t('Edit', 'تحرير')}
                    </Button>
                    {deviceDetail.status === 'offline' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="button-activate-device"
                        disabled={updateDevice.isPending}
                        onClick={() => updateDevice.mutate({ id: deviceDetail.id, data: { status: 'online' } })}
                      >
                        <Wifi className="w-4 h-4 me-2" />
                        {t('Mark Online', 'تعيين كمتصل')}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        data-testid="button-deactivate-device"
                        disabled={updateDevice.isPending}
                        onClick={() => setConfirmStatusOpen(true)}
                      >
                        {t('Deactivate', 'إلغاء التنشيط')}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Specs Grid */}
                <div>
                  <h4 className="font-semibold mb-3">{t('Specifications', 'المواصفات')}</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="p-3 rounded-md bg-muted/50">
                      <p className="text-xs text-muted-foreground mb-1">{t('Vendor', 'الشركة المصنعة')}</p>
                      <p className="font-semibold">{deviceDetail.vendor}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/50">
                      <p className="text-xs text-muted-foreground mb-1">{t('Model', 'الموديل')}</p>
                      <p className="font-semibold">{deviceDetail.model}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/50">
                      <p className="text-xs text-muted-foreground mb-1">{t('Serial Number', 'الرقم التسلسلي')}</p>
                      <p className="font-semibold font-mono text-sm">{deviceDetail.serialNumber}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/50">
                      <p className="text-xs text-muted-foreground mb-1">{t('IP Address', 'عنوان IP')}</p>
                      <p className="font-semibold font-mono text-sm">{deviceDetail.ipAddress}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/50">
                      <p className="text-xs text-muted-foreground mb-1">{t('Firmware', 'البرنامج الثابت')}</p>
                      <p className="font-semibold">{deviceDetail.firmwareVersion}</p>
                    </div>
                    <div className="p-3 rounded-md bg-muted/50">
                      <p className="text-xs text-muted-foreground mb-1">{t('Protocol', 'البروتوكول')}</p>
                      <p className="font-semibold">{deviceDetail.integrationProtocol}</p>
                    </div>
                  </div>
                </div>

                {/* Health Metrics */}
                {deviceHealth && (
                  <div>
                    <h4 className="font-semibold mb-3">{t('Health & Performance', 'الصحة والأداء')}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <div className="flex items-center gap-3 p-3 rounded-md border">
                        <Activity className="w-8 h-8 text-primary" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('Uptime', 'وقت التشغيل')}</p>
                          <p className="text-lg font-bold">{deviceHealth.uptimePercent}%</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-md border">
                        <CheckCircle className="w-8 h-8 text-emerald-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('Signal Strength', 'قوة الإشارة')}</p>
                          <p className="text-lg font-bold">{deviceHealth.signalStrength ?? '-'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-md border">
                        <Clock className="w-8 h-8 text-blue-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('Records Today', 'سجلات اليوم')}</p>
                          <p className="text-lg font-bold">{deviceHealth.recordsToday}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-md border">
                        <XCircle className="w-8 h-8 text-destructive" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('Error Log Entries', 'إدخالات سجل الأخطاء')}</p>
                          <p className="text-lg font-bold">{deviceHealth.errorLog?.length ?? 0}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 rounded-md border md:col-span-2">
                        <Activity className="w-8 h-8 text-muted-foreground" />
                        <div>
                          <p className="text-xs text-muted-foreground">{t('Last Ping', 'آخر نبضة')}</p>
                          <p className="text-sm font-semibold">
                            {deviceHealth.lastPingAt
                              ? new Date(deviceHealth.lastPingAt).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')
                              : '-'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* SDK Integration */}
                <div>
                  <h4 className="font-semibold mb-3">{t('SDK Integration', 'تكامل SDK')}</h4>
                  <div className="p-4 rounded-md border bg-card space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t('Integration Protocol', 'بروتوكول التكامل')}</span>
                      <Badge variant="secondary">{deviceDetail.integrationProtocol}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t('Connection Status', 'حالة الاتصال')}</span>
                      {deviceDetail.status === 'online' ? (
                        <Badge className="bg-emerald-500/10 text-emerald-500">{t('Connected', 'متصل')}</Badge>
                      ) : (
                        <Badge variant="secondary">{t('Disconnected', 'غير متصل')}</Badge>
                      )}
                    </div>
                  </div>
                </div>

                {/* Enrolled Employees */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold">{t('Enrolled Employees', 'الموظفون المسجلون')}</h4>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setLocation('/attendance')}
                    >
                      {t('Manage Enrollments', 'إدارة التسجيلات')} →
                    </Button>
                  </div>
                  {loadingMappings ? (
                    <Skeleton className="h-16 w-full" />
                  ) : (
                    <div className="p-4 rounded-md border bg-muted/30">
                      <div className="flex items-center gap-3">
                        <Cpu className="w-8 h-8 text-muted-foreground" />
                        <div>
                          <p className="text-2xl font-bold">{mappings.filter(m => m.isActive).length}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('Active enrollments', 'تسجيلات نشطة')} / {mappings.length} {t('total', 'إجمالي')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SDK Integrations Card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-primary">
            <Cpu className="w-5 h-5" />
            {t('SDK Integrations', 'تكاملات SDK')}
          </CardTitle>
          <CardDescription>
            {t('Manage third-party device integrations and protocols', 'إدارة تكاملات الأجهزة التابعة لجهات خارجية والبروتوكولات')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {gateways === null ? (
            <div className="p-4 bg-background rounded-md border border-dashed border-border" data-testid="sdk-integrations-unavailable">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-muted-foreground">{t('Integration status unavailable', 'حالة التكامل غير متاحة')}</span>
                <Badge variant="outline" className="text-muted-foreground border-dashed">{t('Unknown', 'غير معروف')}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('Sign in with an administrator account to view live gateway integration status.', 'سجّل الدخول بحساب مسؤول لعرض حالة تكامل البوابات المباشرة.')}
              </p>
            </div>
          ) : gateways.length === 0 ? (
            <div className="p-4 bg-background rounded-md border border-dashed border-border" data-testid="sdk-integrations-empty">
              <div className="flex justify-between items-center mb-2">
                <span className="font-semibold text-muted-foreground">{t('No SDK integrations configured', 'لا توجد تكاملات SDK مهيأة')}</span>
                <Badge variant="outline" className="text-muted-foreground border-dashed">{t('Not Configured', 'غير مهيأ')}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('Register an attendance gateway to connect vendor SDKs (ZKAccess, Suprema BioStar, OSDP) to this system.', 'سجّل بوابة حضور لربط أدوات تطوير الموردين (ZKAccess وSuprema BioStar وOSDP) بهذا النظام.')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {gateways.map((g) => {
                const isActive = g.status === 'ACTIVE';
                const online = isActive && !g.silent;
                const lastContact = g.lastHeartbeatAt ?? g.lastSeenAt;
                return (
                  <div key={g.id} className="p-4 bg-background rounded-md border border-border" data-testid={`sdk-integration-${g.id}`}>
                    <div className="flex justify-between items-center mb-2 gap-2">
                      <span className="font-semibold truncate">{lang === 'ar' && g.nameAr ? g.nameAr : g.name}</span>
                      {online ? (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 shrink-0">{t('Connected', 'متصل')}</Badge>
                      ) : isActive ? (
                        <Badge variant="destructive" className="shrink-0">{t('Offline', 'غير متصل')}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground shrink-0">{g.status}</Badge>
                      )}
                    </div>
                    {g.adapterType && (
                      <p className="text-xs text-muted-foreground mb-2 font-mono">{t('Adapter', 'المحوّل')}: {g.adapterType}</p>
                    )}
                    <div className="text-xs font-mono text-muted-foreground bg-muted p-2 rounded">
                      {t('Last heartbeat', 'آخر نبضة')}: {lastContact
                        ? new Date(lastContact).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US')
                        : t('never', 'أبدًا')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Register Device Dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Register Device', 'تسجيل جهاز')}</DialogTitle>
            <DialogDescription>
              {t('Add a new biometric attendance device to the fleet.', 'أضف جهاز حضور بصمة جديدًا إلى الأسطول.')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2">
              <Label>{t('Name', 'الاسم')} *</Label>
              <Input value={registerForm.name} onChange={e => setRegisterForm(f => ({ ...f, name: e.target.value }))} data-testid="input-device-name" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Vendor', 'الشركة المصنعة')} *</Label>
              <Input value={registerForm.vendor} onChange={e => setRegisterForm(f => ({ ...f, vendor: e.target.value }))} data-testid="input-device-vendor" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Model', 'الموديل')} *</Label>
              <Input value={registerForm.model} onChange={e => setRegisterForm(f => ({ ...f, model: e.target.value }))} data-testid="input-device-model" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Serial Number', 'الرقم التسلسلي')} *</Label>
              <Input value={registerForm.serialNumber} onChange={e => setRegisterForm(f => ({ ...f, serialNumber: e.target.value }))} data-testid="input-device-serial" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('IP Address', 'عنوان IP')}</Label>
              <Input value={registerForm.ipAddress ?? ''} onChange={e => setRegisterForm(f => ({ ...f, ipAddress: e.target.value }))} data-testid="input-device-ip" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Location (English)', 'الموقع (إنجليزي)')} *</Label>
              <Input value={registerForm.location} onChange={e => setRegisterForm(f => ({ ...f, location: e.target.value }))} data-testid="input-device-location" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Location (Arabic)', 'الموقع (عربي)')} *</Label>
              <Input dir="rtl" value={registerForm.locationAr} onChange={e => setRegisterForm(f => ({ ...f, locationAr: e.target.value }))} data-testid="input-device-location-ar" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Integration Protocol', 'بروتوكول التكامل')} *</Label>
              <Input value={registerForm.integrationProtocol} onChange={e => setRegisterForm(f => ({ ...f, integrationProtocol: e.target.value }))} data-testid="input-device-protocol" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Firmware Version', 'إصدار البرنامج الثابت')}</Label>
              <Input value={registerForm.firmwareVersion ?? ''} onChange={e => setRegisterForm(f => ({ ...f, firmwareVersion: e.target.value }))} data-testid="input-device-firmware" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
            <Button
              data-testid="button-submit-register"
              disabled={
                createDevice.isPending ||
                !registerForm.name.trim() ||
                !registerForm.vendor.trim() ||
                !registerForm.model.trim() ||
                !registerForm.serialNumber.trim() ||
                !registerForm.location.trim() ||
                !registerForm.locationAr.trim() ||
                !registerForm.integrationProtocol.trim()
              }
              onClick={() => createDevice.mutate({
                data: {
                  ...registerForm,
                  ipAddress: registerForm.ipAddress?.trim() ? registerForm.ipAddress.trim() : null,
                  firmwareVersion: registerForm.firmwareVersion?.trim() ? registerForm.firmwareVersion.trim() : null,
                },
              })}
            >
              {createDevice.isPending ? t('Registering…', 'جارٍ التسجيل…') : t('Register', 'تسجيل')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Device Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Edit Device', 'تحرير الجهاز')}</DialogTitle>
            <DialogDescription>
              {t('Update the device configuration.', 'تحديث إعدادات الجهاز.')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2">
              <Label>{t('Name', 'الاسم')} *</Label>
              <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} data-testid="input-edit-name" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('IP Address', 'عنوان IP')}</Label>
              <Input value={editForm.ipAddress} onChange={e => setEditForm(f => ({ ...f, ipAddress: e.target.value }))} data-testid="input-edit-ip" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Firmware Version', 'إصدار البرنامج الثابت')}</Label>
              <Input value={editForm.firmwareVersion} onChange={e => setEditForm(f => ({ ...f, firmwareVersion: e.target.value }))} data-testid="input-edit-firmware" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Location (English)', 'الموقع (إنجليزي)')} *</Label>
              <Input value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} data-testid="input-edit-location" />
            </div>
            <div className="space-y-1.5">
              <Label>{t('Location (Arabic)', 'الموقع (عربي)')} *</Label>
              <Input dir="rtl" value={editForm.locationAr} onChange={e => setEditForm(f => ({ ...f, locationAr: e.target.value }))} data-testid="input-edit-location-ar" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>{t('Notes', 'ملاحظات')}</Label>
              <Input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-edit-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t('Cancel', 'إلغاء')}</Button>
            <Button
              data-testid="button-submit-edit"
              disabled={updateDevice.isPending || !selectedId || !editForm.name.trim() || !editForm.location.trim() || !editForm.locationAr.trim()}
              onClick={() => selectedId && updateDevice.mutate({
                id: selectedId,
                data: {
                  name: editForm.name.trim(),
                  ipAddress: editForm.ipAddress.trim() ? editForm.ipAddress.trim() : null,
                  location: editForm.location.trim(),
                  locationAr: editForm.locationAr.trim(),
                  firmwareVersion: editForm.firmwareVersion.trim() ? editForm.firmwareVersion.trim() : null,
                  notes: editForm.notes.trim() ? editForm.notes.trim() : null,
                },
              })}
            >
              {updateDevice.isPending ? t('Saving…', 'جارٍ الحفظ…') : t('Save Changes', 'حفظ التغييرات')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation */}
      <AlertDialog open={confirmStatusOpen} onOpenChange={setConfirmStatusOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Deactivate this device?', 'إلغاء تنشيط هذا الجهاز؟')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'The device will be marked offline in the system and will no longer be counted as an active attendance terminal. You can mark it online again at any time.',
                'سيتم تعيين الجهاز كغير متصل في النظام ولن يُحتسب كجهاز حضور نشط. يمكنك تعيينه كمتصل مرة أخرى في أي وقت.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel', 'إلغاء')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-deactivate"
              disabled={updateDevice.isPending}
              onClick={() => selectedId && updateDevice.mutate({ id: selectedId, data: { status: 'offline' } })}
            >
              {t('Deactivate', 'إلغاء التنشيط')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AnimatedPage>
  );
}
