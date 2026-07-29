import { useState, useMemo } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useListDepartments } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { ChevronLeft, ChevronRight, CalendarDays, Users, XCircle, AlertCircle, CalendarOff } from 'lucide-react';

interface RosterEntry {
  id: number;
  employeeId: number;
  employeeNameEn: string;
  employeeNameAr: string;
  shiftId: number | null;
  shiftCode: string | null;
  date: string;
  status: 'scheduled' | 'worked' | 'absent' | 'late' | 'off' | 'holiday';
  isOffDay: boolean;
  isPublicHoliday: boolean;
}

interface Shift {
  id: number;
  shiftCode: string;
  color: string;
  nameEn: string;
  nameAr: string;
}

function getWeekDates(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const DAY_LABELS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS_AR = ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];

export default function Rosters() {
  const { t, lang } = useLanguage();
  const [weekStart, setWeekStart] = useState<Date>(() => getMonday(new Date()));
  const [departmentId, setDepartmentId] = useState<string>('all');

  const { data: departments } = useListDepartments();

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEnd = weekDates[6];
  const weekStartStr = weekDates[0];

  const { data: rosters, isLoading: loadingRosters } = useQuery<RosterEntry[]>({
    queryKey: ['rosters', weekStartStr, weekEnd, departmentId],
    queryFn: () => {
      let url = `/api/rosters?weekStart=${weekStartStr}&weekEnd=${weekEnd}`;
      if (departmentId !== 'all') url += `&departmentId=${departmentId}`;
      return fetch(url, { credentials: 'include' }).then(r => r.json());
    },
  });

  const { data: shifts } = useQuery<Shift[]>({
    queryKey: ['shifts'],
    queryFn: () => fetch('/api/shifts', { credentials: 'include' }).then(r => r.json()),
  });

  const shiftColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    shifts?.forEach(s => { map[s.shiftCode] = s.color; });
    return map;
  }, [shifts]);

  const employees = useMemo(() => {
    if (!rosters) return [];
    const seen = new Set<number>();
    const result: { id: number; nameEn: string; nameAr: string }[] = [];
    for (const r of rosters) {
      if (!seen.has(r.employeeId)) {
        seen.add(r.employeeId);
        result.push({ id: r.employeeId, nameEn: r.employeeNameEn, nameAr: r.employeeNameAr });
      }
    }
    return result;
  }, [rosters]);

  const rosterMap = useMemo(() => {
    const map: Record<string, Record<string, RosterEntry>> = {};
    rosters?.forEach(r => {
      if (!map[r.employeeId]) map[r.employeeId] = {};
      map[r.employeeId][r.date] = r;
    });
    return map;
  }, [rosters]);

  const stats = useMemo(() => {
    if (!rosters) return { present: 0, absent: 0, late: 0, off: 0 };
    return {
      present: rosters.filter(r => r.status === 'worked' || r.status === 'scheduled').length,
      absent: rosters.filter(r => r.status === 'absent').length,
      late: rosters.filter(r => r.status === 'late').length,
      off: rosters.filter(r => r.isOffDay || r.isPublicHoliday).length,
    };
  }, [rosters]);

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const formatWeekLabel = () => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const locale = lang === 'ar' ? 'ar-SA' : 'en-US';
    const start = new Date(weekDates[0]).toLocaleDateString(locale, opts);
    const end = new Date(weekDates[6]).toLocaleDateString(locale, opts);
    return `${start} – ${end}`;
  };

  const getCellContent = (entry: RosterEntry | undefined, date: string) => {
    if (!entry) {
      return (
        <span className="text-xs text-muted-foreground/40">—</span>
      );
    }
    if (entry.isPublicHoliday) {
      return (
        <span className="text-xs font-semibold text-slate-400 bg-slate-500/10 px-1.5 py-0.5 rounded">
          HOL
        </span>
      );
    }
    if (entry.isOffDay) {
      return (
        <span className="text-xs font-semibold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
          OFF
        </span>
      );
    }
    if (entry.shiftCode) {
      const color = shiftColorMap[entry.shiftCode] ?? '#6366F1';
      return (
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded text-white"
          style={{ backgroundColor: color }}
        >
          {entry.shiftCode}
        </span>
      );
    }
    return (
      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
        entry.status === 'absent' ? 'bg-rose-500/10 text-rose-500' :
        entry.status === 'late' ? 'bg-amber-500/10 text-amber-500' :
        'bg-blue-500/10 text-blue-500'
      }`}>
        {entry.status.toUpperCase().slice(0, 3)}
      </span>
    );
  };

  return (
    <AnimatedPage className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Roster Management', 'إدارة الجداول الزمنية')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Weekly shift roster by employee and department.', 'جدول الورديات الأسبوعي حسب الموظف والقسم.')}
          </p>
        </div>
      </div>

      {/* Week Navigator + Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevWeek}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-[180px] text-center">
            <p className="text-sm font-semibold">{formatWeekLabel()}</p>
            <p className="text-xs text-muted-foreground">{t('Week view', 'عرض أسبوعي')}</p>
          </div>
          <Button variant="outline" size="icon" onClick={nextWeek}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(getMonday(new Date()))}>
            {t('Today', 'اليوم')}
          </Button>
        </div>

        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder={t('All Departments', 'جميع الأقسام')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('All Departments', 'جميع الأقسام')}</SelectItem>
            {departments?.map(d => (
              <SelectItem key={d.id} value={String(d.id)}>
                {lang === 'en' ? d.nameEn : d.nameAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Roster Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="min-w-[160px] sticky start-0 bg-muted/30 z-10">
                  {t('Employee', 'الموظف')}
                </TableHead>
                {weekDates.map((date, idx) => (
                  <TableHead key={date} className="text-center min-w-[80px]">
                    <div className="text-xs font-semibold">
                      {lang === 'en' ? DAY_LABELS_EN[idx] : DAY_LABELS_AR[idx]}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-normal">
                      {new Date(date + 'T00:00:00').toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRosters ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : employees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <CalendarDays className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    {t('No roster data for this period.', 'لا توجد بيانات جدول لهذه الفترة.')}
                  </TableCell>
                </TableRow>
              ) : (
                employees.map(emp => (
                  <TableRow key={emp.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium sticky start-0 bg-background z-10">
                      {lang === 'en' ? emp.nameEn : emp.nameAr}
                    </TableCell>
                    {weekDates.map(date => {
                      const entry = rosterMap[emp.id]?.[date];
                      const isAbsent = entry?.status === 'absent';
                      return (
                        <TableCell
                          key={date}
                          className={`text-center ${isAbsent ? 'bg-rose-500/5' : ''}`}
                        >
                          {getCellContent(entry, date)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Users className="w-8 h-8 text-emerald-500" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Present / Scheduled', 'حاضر / مجدول')}</p>
              <p className="text-2xl font-bold text-emerald-500">{stats.present}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <XCircle className="w-8 h-8 text-rose-500" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Absent', 'غائب')}</p>
              <p className="text-2xl font-bold text-rose-500">{stats.absent}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Late', 'متأخر')}</p>
              <p className="text-2xl font-bold text-amber-500">{stats.late}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <CalendarOff className="w-8 h-8 text-slate-400" />
            <div>
              <p className="text-sm text-muted-foreground">{t('Off / Holiday', 'إجازة / عطلة')}</p>
              <p className="text-2xl font-bold text-slate-400">{stats.off}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AnimatedPage>
  );
}
