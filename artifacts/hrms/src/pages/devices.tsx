import { useLanguage } from '@/hooks/use-language';
import { useListDevices, useCreateDevice, useGetDevice, useUpdateDevice, useDeleteDevice, useGetDeviceHealth, getGetDeviceQueryKey, getGetDeviceHealthQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Cpu, Wifi, WifiOff, AlertCircle, Plus, Settings } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Devices() {
  const { t, lang } = useLanguage();
  const { data: devices, isLoading } = useListDevices();
  const createDevice = useCreateDevice();
  const updateDevice = useUpdateDevice();
  const deleteDevice = useDeleteDevice();
  const { data: deviceDetail } = useGetDevice(1, { query: { enabled: false, queryKey: getGetDeviceQueryKey(1) } });
  const { data: deviceHealth } = useGetDeviceHealth(1, { query: { enabled: false, queryKey: getGetDeviceHealthQueryKey(1) } });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': return <Wifi className="w-4 h-4 text-emerald-500" />;
      case 'offline': return <WifiOff className="w-4 h-4 text-muted-foreground" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-destructive" />;
      default: return <Cpu className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('Device Fleet', 'أسطول الأجهزة')}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('Device Name', 'اسم الجهاز')}</TableHead>
                    <TableHead>{t('Location', 'الموقع')}</TableHead>
                    <TableHead>{t('Vendor/Model', 'المصنع/الموديل')}</TableHead>
                    <TableHead>{t('Status', 'الحالة')}</TableHead>
                    <TableHead className="text-end">{t('Action', 'الإجراء')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-8 ms-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : !devices || devices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        {t('No devices found.', 'لا توجد أجهزة.')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    devices.map((device) => (
                      <TableRow key={device.id} className="group cursor-pointer">
                        <TableCell className="font-medium">
                          {device.name}
                          <div className="text-xs text-muted-foreground font-mono mt-1">{device.ipAddress}</div>
                        </TableCell>
                        <TableCell>
                          {lang === 'en' ? device.location : device.locationAr}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">{device.vendor}</span>
                            <span className="text-xs text-muted-foreground">{device.model}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(device.status)}
                            <span className="capitalize text-sm">{device.status}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-end">
                          <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100">
                            <Settings className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2 text-primary">
                <Cpu className="w-5 h-5" />
                {t('SDK Integrations', 'تكاملات SDK')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 bg-background rounded-md border border-border">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold">ZKAccess SDK</span>
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500">Connected</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">Protocol: Push (REST)</p>
                <div className="text-xs font-mono text-muted-foreground bg-muted p-2 rounded">
                  Status: 3 active workers<br/>
                  Last sync: 2m ago
                </div>
              </div>
              
              <div className="p-3 bg-background rounded-md border border-border">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold">OSDP Controller</span>
                  <Badge variant="outline" className="text-muted-foreground">Standby</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">Protocol: RS-485 via Gateway</p>
              </div>

              <div className="p-3 bg-background rounded-md border border-border border-dashed">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-muted-foreground">Suprema BioStar</span>
                  <Badge variant="outline" className="text-muted-foreground border-dashed">Not Configured</Badge>
                </div>
                <Button variant="link" size="sm" className="px-0 h-auto text-xs mt-2">
                  Configure Integration &rarr;
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
