import { apiFetch } from '@/lib/api';
import { useState } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useListDevices } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import {
  Fingerprint, AlertTriangle, CheckCircle2, Cpu, ShieldCheck, XCircle
} from 'lucide-react';

interface PunchEvent {
  id: number;
  employeeId: number;
  employeeNameEn: string;
  employeeNameAr: string;
  eventType: 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END' | 'OVERTIME_START' | 'OVERTIME_END';
  source: 'BIOMETRIC' | 'MANUAL' | 'CORRECTION';
  deviceId: number | null;
  deviceName: string | null;
  eventTime: string;
  isVerified: boolean;
  isMissing: boolean;
  rawData?: Record<string, unknown> | null;
}

const EVENT_TYPE_COLORS: Record<string, string> = {
  CLOCK_IN: 'bg-emerald-500/10 text-emerald-500',
  CLOCK_OUT: 'bg-rose-500/10 text-rose-500',
  BREAK_START: 'bg-amber-500/10 text-amber-500',
  BREAK_END: 'bg-amber-500/10 text-amber-500',
  OVERTIME_START: 'bg-violet-500/10 text-violet-500',
  OVERTIME_END: 'bg-violet-500/10 text-violet-500',
};

const SOURCE_COLORS: Record<string, string> = {
  BIOMETRIC: 'bg-blue-500/10 text-blue-500',
  MANUAL: 'bg-amber-500/10 text-amber-500',
  CORRECTION: 'bg-orange-500/10 text-orange-500',
};

function formatEventType(type: string): string {
  return type.replace(/_/g, ' ');
}

export default function PunchEvents() {
  const { t, lang } = useLanguage();
  const today = new Date().toISOString().split('T')[0];

  const [filterDate, setFilterDate] = useState(today);
  const [filterEventType, setFilterEventType] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [missingOnly, setMissingOnly] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<PunchEvent | null>(null);

  const { data: events, isLoading } = useQuery<PunchEvent[]>({
    queryKey: ['punch-events'],
    queryFn: () =>
      apiFetch('/api/punch-events?limit=100', { credentials: 'include' }).then(r => r.json()),
  });

  const { data: missingData } = useQuery<PunchEvent[]>({
    queryKey: ['punch-events-missing'],
    queryFn: () =>
      apiFetch('/api/punch-events/missing', { credentials: 'include' }).then(r => r.json()),
  });

  const filtered = (events ?? []).filter(ev => {
    if (filterDate && !ev.eventTime.startsWith(filterDate)) return false;
    if (filterEventType !== 'all' && ev.eventType !== filterEventType) return false;
    if (filterSource !== 'all' && ev.source !== filterSource) return false;
    if (missingOnly && !ev.isMissing) return false;
    return true;
  });

  const totalEvents = events?.length ?? 0;
  const missingCount = missingData?.length ?? (events?.filter(e => e.isMissing).length ?? 0);
  const manualCount = events?.filter(e => e.source === 'MANUAL').length ?? 0;
  const biometricCount = events?.filter(e => e.source === 'BIOMETRIC').length ?? 0;

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const formatDateTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US');
    } catch {
      return iso;
    }
  };

  return (
    <AnimatedPage className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('Punch Event Log', 'سجل أحداث البصمة')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('Real-time biometric punch events and audit trail.', 'أحداث البصمة البيومترية في الوقت الفعلي ومسار التدقيق.')}
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Fingerprint className="w-8 h-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Total Events', 'إجمالي الأحداث')}</p>
              <p className="text-2xl font-bold">{isLoading ? '—' : totalEvents}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-rose-500" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Missing Punches', 'بصمات مفقودة')}</p>
              <p className="text-2xl font-bold text-rose-500">{isLoading ? '—' : missingCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Manual Entries', 'إدخال يدوي')}</p>
              <p className="text-2xl font-bold text-amber-500">{isLoading ? '—' : manualCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Cpu className="w-8 h-8 text-blue-500" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Biometric', 'بيومتري')}</p>
              <p className="text-2xl font-bold text-blue-500">{isLoading ? '—' : biometricCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              className="w-auto"
            />
            <Select value={filterEventType} onValueChange={setFilterEventType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t('Event Type', 'نوع الحدث')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All Types', 'جميع الأنواع')}</SelectItem>
                <SelectItem value="CLOCK_IN">CLOCK IN</SelectItem>
                <SelectItem value="CLOCK_OUT">CLOCK OUT</SelectItem>
                <SelectItem value="BREAK_START">BREAK START</SelectItem>
                <SelectItem value="BREAK_END">BREAK END</SelectItem>
                <SelectItem value="OVERTIME_START">OVERTIME START</SelectItem>
                <SelectItem value="OVERTIME_END">OVERTIME END</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t('Source', 'المصدر')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All Sources', 'جميع المصادر')}</SelectItem>
                <SelectItem value="BIOMETRIC">{t('Biometric', 'بيومتري')}</SelectItem>
                <SelectItem value="MANUAL">{t('Manual', 'يدوي')}</SelectItem>
                <SelectItem value="CORRECTION">{t('Correction', 'تصحيح')}</SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={missingOnly}
                onChange={e => setMissingOnly(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm font-medium">{t('Missing Only', 'المفقودة فقط')}</span>
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setFilterDate(today); setFilterEventType('all'); setFilterSource('all'); setMissingOnly(false); }}
            >
              {t('Reset', 'إعادة تعيين')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>{t('Time', 'الوقت')}</TableHead>
                <TableHead>{t('Employee', 'الموظف')}</TableHead>
                <TableHead>{t('Event Type', 'نوع الحدث')}</TableHead>
                <TableHead>{t('Source', 'المصدر')}</TableHead>
                <TableHead>{t('Device', 'الجهاز')}</TableHead>
                <TableHead className="text-center">{t('Verified', 'موثق')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <Fingerprint className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    {t('No punch events found.', 'لم يتم العثور على أحداث بصمة.')}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(ev => (
                  <TableRow
                    key={ev.id}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${ev.isMissing ? 'bg-rose-500/5 border-s-2 border-rose-500' : ''}`}
                    onClick={() => setSelectedEvent(ev)}
                  >
                    <TableCell className="font-mono text-sm">
                      {formatTime(ev.eventTime)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {lang === 'en' ? ev.employeeNameEn : ev.employeeNameAr}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs border-transparent ${EVENT_TYPE_COLORS[ev.eventType] ?? 'bg-muted text-muted-foreground'}`}
                      >
                        {formatEventType(ev.eventType)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs border-transparent ${SOURCE_COLORS[ev.source] ?? 'bg-muted text-muted-foreground'}`}
                      >
                        {ev.source}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {ev.deviceName || '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      {ev.isVerified ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Event Detail Dialog */}
      <Dialog open={!!selectedEvent} onOpenChange={open => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Punch Event Detail', 'تفاصيل حدث البصمة')}</DialogTitle>
            <DialogDescription>
              {selectedEvent && formatDateTime(selectedEvent.eventTime)}
            </DialogDescription>
          </DialogHeader>

          {selectedEvent && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{t('Employee', 'الموظف')}</p>
                  <p className="font-semibold text-sm">
                    {lang === 'en' ? selectedEvent.employeeNameEn : selectedEvent.employeeNameAr}
                  </p>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{t('Event Type', 'نوع الحدث')}</p>
                  <Badge className={`text-xs border-transparent ${EVENT_TYPE_COLORS[selectedEvent.eventType] ?? ''}`}>
                    {formatEventType(selectedEvent.eventType)}
                  </Badge>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{t('Source', 'المصدر')}</p>
                  <Badge className={`text-xs border-transparent ${SOURCE_COLORS[selectedEvent.source] ?? ''}`}>
                    {selectedEvent.source}
                  </Badge>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{t('Device', 'الجهاز')}</p>
                  <p className="font-semibold text-sm">{selectedEvent.deviceName || '-'}</p>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{t('Verified', 'موثق')}</p>
                  <p className="font-semibold text-sm">
                    {selectedEvent.isVerified
                      ? t('Yes', 'نعم')
                      : t('No', 'لا')}
                  </p>
                </div>
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-1">{t('Missing Punch', 'بصمة مفقودة')}</p>
                  <p className={`font-semibold text-sm ${selectedEvent.isMissing ? 'text-rose-500' : 'text-muted-foreground'}`}>
                    {selectedEvent.isMissing
                      ? t('Yes — Missing', 'نعم — مفقودة')
                      : t('No', 'لا')}
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">{t('Event Time', 'وقت الحدث')}</p>
                <p className="font-mono text-sm">{formatDateTime(selectedEvent.eventTime)}</p>
              </div>

              <div className="p-3 rounded-md bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">{t('Event ID', 'معرف الحدث')}</p>
                <p className="font-mono text-sm text-muted-foreground">#{selectedEvent.id}</p>
              </div>

              {selectedEvent.rawData && (
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-xs text-muted-foreground mb-2">{t('Raw Data', 'البيانات الخام')}</p>
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all overflow-auto max-h-36">
                    {JSON.stringify(selectedEvent.rawData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
