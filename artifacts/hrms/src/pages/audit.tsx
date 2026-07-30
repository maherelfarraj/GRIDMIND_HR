import { useLanguage } from '@/hooks/use-language';
import { useListAuditLogs } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Shield, Search, Lock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Audit() {
  const { t } = useLanguage();
  const { data: auditData, isLoading } = useListAuditLogs();

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
          <div className="relative max-w-sm">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder={t('Search by user, entity, or action...', 'البحث حسب المستخدم، الكيان، أو الإجراء...')}
              className="ps-9 bg-muted/50 border-transparent focus-visible:bg-background"
            />
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
                      <Badge variant="outline" className={`font-mono text-[10px] uppercase rounded-sm border-transparent
                        ${log.action === 'CREATE' ? 'bg-emerald-500/10 text-emerald-500' : 
                          log.action === 'UPDATE' ? 'bg-blue-500/10 text-blue-500' : 
                          log.action === 'DELETE' ? 'bg-red-500/10 text-red-500' : 
                          log.action === 'login.failed' ? 'bg-amber-500/10 text-amber-500' : 
                          log.action === 'login.lockout' ? 'bg-red-500/10 text-red-500' : 'bg-muted'}
                      `}>
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground uppercase">{log.entityType}</span>
                      {log.entityId && <span className="ms-2 text-foreground">#{log.entityId}</span>}
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
      </Card>
    </div>
  );
}
