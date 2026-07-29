import { useLanguage } from '@/hooks/use-language';
import { useListApprovals, useCreateApproval, useGetApproval, useDecideApproval, getGetApprovalQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckSquare, XSquare, Clock, AlertTriangle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Approvals() {
  const { t, lang } = useLanguage();
  const { data: approvalsData, isLoading } = useListApprovals();
  const createApproval = useCreateApproval();
  const decideApproval = useDecideApproval();
  const { data: approvalDetail } = useGetApproval(1, { query: { enabled: false, queryKey: getGetApprovalQueryKey(1) } });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'critical':
        return <Badge variant="destructive" className="flex gap-1 items-center"><AlertTriangle className="w-3 h-3"/>{t('Critical', 'حرج')}</Badge>;
      case 'high':
        return <Badge className="bg-orange-500 hover:bg-orange-600 text-white">{t('High', 'عالي')}</Badge>;
      case 'normal':
        return <Badge variant="secondary">{t('Normal', 'عادي')}</Badge>;
      default:
        return <Badge variant="outline">{priority}</Badge>;
    }
  };

  const renderTable = (filterStatus: string) => {
    if (isLoading) {
      return (
        <div className="space-y-2 mt-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      );
    }

    const filtered = approvalsData?.filter(a => filterStatus === 'all' || a.status === filterStatus) || [];

    if (filtered.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground border rounded-lg mt-4 border-dashed bg-card/50">
          {t('No approvals in this queue.', 'لا توجد موافقات في قائمة الانتظار هذه.')}
        </div>
      );
    }

    return (
      <div className="border rounded-lg mt-4 bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Request', 'الطلب')}</TableHead>
              <TableHead>{t('Requester', 'مقدم الطلب')}</TableHead>
              <TableHead>{t('Type', 'النوع')}</TableHead>
              <TableHead>{t('Priority', 'الأولوية')}</TableHead>
              <TableHead>{t('Date', 'التاريخ')}</TableHead>
              {filterStatus === 'pending' && <TableHead className="text-end">{t('Action', 'الإجراء')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(item => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">
                  {lang === 'en' ? item.titleEn : item.titleAr}
                </TableCell>
                <TableCell>{item.requestedByEmployeeNameEn}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize">{item.type}</Badge></TableCell>
                <TableCell>{getPriorityBadge(item.priority)}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(item.createdAt).toLocaleDateString()}</TableCell>
                {filterStatus === 'pending' && (
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-destructive/10">
                        <XSquare className="w-4 h-4 me-1" />
                        {t('Reject', 'رفض')}
                      </Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        <CheckSquare className="w-4 h-4 me-1" />
                        {t('Approve', 'موافقة')}
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('Workflow Approvals', 'موافقات سير العمل')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('Review and decide on operational requests.', 'مراجعة واتخاذ قرار بشأن الطلبات التشغيلية.')}
        </p>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {t('Pending', 'قيد الانتظار')}
          </TabsTrigger>
          <TabsTrigger value="approved">{t('Approved', 'تمت الموافقة')}</TabsTrigger>
          <TabsTrigger value="rejected">{t('Rejected', 'مرفوض')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">{renderTable('pending')}</TabsContent>
        <TabsContent value="approved">{renderTable('approved')}</TabsContent>
        <TabsContent value="rejected">{renderTable('rejected')}</TabsContent>
      </Tabs>
    </div>
  );
}
