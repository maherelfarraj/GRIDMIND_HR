import { useLanguage } from '@/hooks/use-language';
import { useListAuditLogs } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Shield, Search, Lock, KeyRound, FileKey, Network, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDebounce } from '@/hooks/use-debounce';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

const SECURITY_ACTIONS = 'login.failed,login.lockout';
const PAGE_SIZES = [50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZES)[number];

const RECOVERY_METHOD_LABELS: Record<string, { en: string; ar: string; icon: React.ReactNode }> = {
  ADMIN_RESET_PASSWORD: {
    en: 'Operator-supplied password',
    ar: 'كلمة مرور يوفرها المشغّل',
    icon: <KeyRound className="w-3 h-3" />,
  },
  OTP_HANDOFF_FILE: {
    en: 'OTP handoff file',
    ar: 'ملف تسليم كلمة المرور',
    icon: <FileKey className="w-3 h-3" />,
  },
};

function EmergencyResetDetail({ changesJson, lang }: { changesJson: string | null; lang: 'en' | 'ar' }) {
  if (!changesJson) return null;
  let detail: Record<string, unknown>;
  try {
    detail = JSON.parse(changesJson);
  } catch {
    return null;
  }
  const source = typeof detail.source === 'string' ? detail.source : null;
  if (!source) return (
    <Badge variant="outline" className="font-sans text-[10px] rounded-sm border-transparent bg-muted text-muted-foreground ms-2">
      {lang === 'ar' ? 'مُسجَّل قبل تتبع الطريقة' : 'Recorded before method tracking'}
    </Badge>
  );
  const label = RECOVERY_METHOD_LABELS[source];
  if (!label) return (
    <Badge variant="outline" className="font-sans text-[10px] rounded-sm border-transparent bg-muted ms-2">
      {source}
    </Badge>
  );
  return (
    <Badge variant="outline" className="font-sans text-[10px] rounded-sm border-transparent bg-violet-500/10 text-violet-600 ms-2 gap-1">
      {label.icon}
      {lang === 'ar' ? label.ar : label.en}
    </Badge>
  );
}

export default function Audit() {
  const { t, lang } = useLanguage();
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [labelSearch, setLabelSearch] = useState('');
  const [ipSearch, setIpSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [page, setPage] = useState(1);
  const debouncedLabel = useDebounce(labelSearch, 300);
  const debouncedIp = useDebounce(ipSearch, 300);

  const hasDateFilter = fromDate || toDate;

  const { data: auditData, isLoading } = useListAuditLogs({
    action: actionFilter === 'all' ? undefined : actionFilter === 'security' ? SECURITY_ACTIONS : actionFilter,
    entityLabel: debouncedLabel || undefined,
    ipAddress: debouncedIp || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    page,
    limit: pageSize,
  });

  const total = auditData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function handleActionChange(value: string) {
    setActionFilter(value);
    setPage(1);
  }

  function handleLabelChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLabelSearch(e.target.value);
    setPage(1);
  }

  function handleIpChange(e: React.ChangeEvent<HTMLInputElement>) {
    setIpSearch(e.target.value);
    setPage(1);
  }

  function handleFromChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFromDate(e.target.value);
    setPage(1);
  }

  function handleToChange(e: React.ChangeEvent<HTMLInputElement>) {
    setToDate(e.target.value);
    setPage(1);
  }

  function handleClearDates() {
    setFromDate('');
    setToDate('');
    setPage(1);
  }

  function handlePageSizeChange(value: string) {
    setPageSize(Number(value) as PageSize);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            {t('Audit Log', 'سجل التدقيق')}
            <Badge variant="secondary" className="font-normal text-xs bg-primary/10 text-primary border-primary/20">
              <Lock className="w-3 h-3 me-1" />
              {t('Immutable', 'غير قابل للتعديل')}
            </Badge>
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('System-wide chronological record of all actions.', 'سجل زمني لجميع الإجراءات على مستوى النظام.')}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b">
          <div className="flex flex-col gap-3">
            {/* Row 1: action, entity label, IP */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={actionFilter} onValueChange={handleActionChange}>
                <SelectTrigger className="w-full sm:w-56" data-testid="select-action-filter">
                  <SelectValue placeholder={t('All actions', 'جميع الإجراءات')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('All actions', 'جميع الإجراءات')}</SelectItem>
                  <SelectItem value="security">{t('Security events', 'أحداث الأمان')}</SelectItem>
                  <SelectItem value="login.failed">{t('Failed logins', 'محاولات دخول فاشلة')}</SelectItem>
                  <SelectItem value="login.lockout">{t('Lockouts', 'حالات القفل')}</SelectItem>
                  <SelectItem value="CREATE">{t('Create', 'إنشاء')}</SelectItem>
                  <SelectItem value="UPDATE">{t('Update', 'تحديث')}</SelectItem>
                  <SelectItem value="DELETE">{t('Delete', 'حذف')}</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={labelSearch}
                  onChange={handleLabelChange}
                  placeholder={t('Filter by username / entity...', 'تصفية حسب اسم المستخدم / الكيان...')}
                  className="ps-9 bg-muted/50 border-transparent focus-visible:bg-background"
                  data-testid="input-entity-label"
                />
              </div>
              <div className="relative w-full sm:max-w-[200px]">
                <Network className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={ipSearch}
                  onChange={handleIpChange}
                  placeholder={t('Filter by IP...', 'تصفية حسب IP...')}
                  className="ps-9 bg-muted/50 border-transparent focus-visible:bg-background"
                  data-testid="input-ip-address"
                />
              </div>
            </div>

            {/* Row 2: date range */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <span className="text-sm text-muted-foreground whitespace-nowrap shrink-0">
                {t('Date range:', 'نطاق التاريخ:')}
              </span>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-1">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={handleFromChange}
                  className="w-full sm:w-44 bg-muted/50 border-transparent focus-visible:bg-background text-sm"
                  data-testid="input-date-from"
                  aria-label={t('From date', 'من تاريخ')}
                />
                <span className="text-muted-foreground text-sm hidden sm:inline">–</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={handleToChange}
                  className="w-full sm:w-44 bg-muted/50 border-transparent focus-visible:bg-background text-sm"
                  data-testid="input-date-to"
                  aria-label={t('To date', 'إلى تاريخ')}
                />
                {hasDateFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearDates}
                    className="text-muted-foreground hover:text-foreground h-8 px-2"
                    data-testid="btn-clear-dates"
                  >
                    <X className="w-3.5 h-3.5 me-1" />
                    {t('Clear', 'مسح')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[180px]">{t('Timestamp', 'الوقت')}</TableHead>
                <TableHead>{t('Actor', 'الفاعل')}</TableHead>
                <TableHead>{t('Action', 'الإجراء')}</TableHead>
                <TableHead>{t('Entity', 'الكيان')}</TableHead>
                <TableHead>{t('IP Address', 'عنوان IP')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : !auditData?.data || auditData.data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    <Shield className="w-8 h-8 mx-auto mb-3 opacity-20" />
                    {t('No audit records found.', 'لم يتم العثور على سجلات تدقيق.')}
                  </TableCell>
                </TableRow>
              ) : (
                auditData.data.map((log) => (
                  <TableRow key={log.id} className="font-mono text-xs">
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {new Date(log.createdAt).toISOString().replace('T', ' ').substring(0, 19)}
                    </TableCell>
                    <TableCell className="font-sans font-medium text-foreground">
                      {log.actorUserName || 'SYSTEM'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center flex-wrap gap-1">
                        <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-sm border-transparent
                          ${log.action === 'CREATE' ? 'bg-emerald-500/10 text-emerald-500' :
                            log.action === 'UPDATE' ? 'bg-blue-500/10 text-blue-500' :
                            log.action === 'DELETE' ? 'bg-red-500/10 text-red-500' :
                            log.action === 'login.failed' ? 'bg-amber-500/10 text-amber-500' :
                            log.action === 'login.lockout' ? 'bg-red-500/10 text-red-500' :
                            log.action === 'admin.emergency_password_reset' ? 'bg-red-500/10 text-red-600' : 'bg-muted'}
                        `}>
                          {log.action}
                        </Badge>
                        {log.action === 'admin.emergency_password_reset' && (
                          <EmergencyResetDetail changesJson={log.changesJson ?? null} lang={lang} />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground uppercase">{log.entityType}</span>
                      {log.entityLabel ? (
                        <span className="ms-2 text-foreground">{log.entityLabel}</span>
                      ) : log.entityId ? (
                        <span className="ms-2 text-foreground">#{log.entityId}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.ipAddress || '-'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>

        {/* Pagination footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              {isLoading ? (
                <Skeleton className="h-4 w-40" />
              ) : (
                t(
                  `${total.toLocaleString()} record${total !== 1 ? 's' : ''} total`,
                  `${total.toLocaleString()} سجل إجمالاً`,
                )
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs">{t('Show:', 'عرض:')}</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-7 w-[70px] text-xs" data-testid="select-page-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Pagination className="w-auto mx-0">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-disabled={page <= 1}
                  className={page <= 1 ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                />
              </PaginationItem>
              <PaginationItem>
                <span className="px-3 py-1 text-sm font-medium tabular-nums">
                  {t(`Page ${page} of ${totalPages}`, `صفحة ${page} من ${totalPages}`)}
                </span>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-disabled={page >= totalPages}
                  className={page >= totalPages ? 'pointer-events-none opacity-40' : 'cursor-pointer'}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </Card>
    </div>
  );
}
