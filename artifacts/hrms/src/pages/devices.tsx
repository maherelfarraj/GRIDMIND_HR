import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useListDevices, useGetDevice, useGetDeviceHealth, getGetDeviceQueryKey, getGetDeviceHealthQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Cpu, Wifi, WifiOff, AlertCircle, Plus, Settings, Activity, Clock, CheckCircle, XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { useLocation } from 'wouter';

interface DeviceMapping {
  deviceId: number;
  employeeId: number;
  employeeNameEn: string;
  isActive: boolean;
}

export default function Devices() {
  const { t, lang } = useLanguage();
  const [, setLocation] = useLocation();
  const { data: devices, isLoading } = useListDevices();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [mappings, setMappings] = useState<DeviceMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);

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
      const res = await fetch(`/api/device-mappings?deviceId=${id}`, { credentials: 'include' });
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
        <Button>
          <Plus className="w-4 h-4 me-2" />
          {t('Register Device', 'تسجيل جهاز')}
        </Button>
      </div>

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
                    <Button variant="outline" size="sm">
                      <Settings className="w-4 h-4 me-2" />
                      {t('Edit', 'تحرير')}
                    </Button>
                    <Button variant="outline" size="sm">
                      <Activity className="w-4 h-4 me-2" />
                      {t('Restart', 'إعادة تشغيل')}
                    </Button>
                    <Button variant="outline" size="sm" className="text-destructive">
                      {t('Deactivate', 'إلغاء التنشيط')}
                    </Button>
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
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-background rounded-md border border-border">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold">ZKAccess SDK</span>
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500">{t('Connected', 'متصل')}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{t('Protocol: Push (REST)', 'البروتوكول: Push (REST)')}</p>
            <div className="text-xs font-mono text-muted-foreground bg-muted p-2 rounded">
              {t('Status: 3 active workers', 'الحالة: 3 عمال نشطين')}<br/>
              {t('Last sync: 2m ago', 'آخر مزامنة: منذ دقيقتين')}
            </div>
          </div>
          
          <div className="p-4 bg-background rounded-md border border-border">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold">OSDP Controller</span>
              <Badge variant="outline" className="text-muted-foreground">{t('Standby', 'استعداد')}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mb-2">{t('Protocol: RS-485 via Gateway', 'البروتوكول: RS-485 عبر البوابة')}</p>
          </div>

          <div className="p-4 bg-background rounded-md border border-dashed border-border">
            <div className="flex justify-between items-center mb-2">
              <span className="font-semibold text-muted-foreground">Suprema BioStar</span>
              <Badge variant="outline" className="text-muted-foreground border-dashed">{t('Not Configured', 'غير مهيأ')}</Badge>
            </div>
            <Button variant="link" size="sm" className="px-0 h-auto text-xs mt-2">
              {t('Configure Integration', 'تكوين التكامل')} &rarr;
            </Button>
          </div>
        </CardContent>
      </Card>
    </AnimatedPage>
  );
}
