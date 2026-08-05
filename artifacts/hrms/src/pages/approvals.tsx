import { useState, Fragment } from 'react';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/hooks/use-auth';
import { localName } from '@/lib/localise';
import { useListApprovals, useDecideApproval, useGetLeaveRequest } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  CheckSquare, 
  XSquare, 
  Clock, 
  AlertTriangle, 
  Calendar, 
  ArrowLeftRight, 
  TrendingUp, 
  FileText, 
  Wrench,
  ChevronDown,
  Paperclip,
  Download
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { AnimatedPage } from '@/components/layout/AnimatedPage';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

function parseMetadata(metadata: unknown): Record<string, unknown> | null {
  if (!metadata) return null;
  if (typeof metadata === 'object') return metadata as Record<string, unknown>;
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Only allow https and safe base64 data URLs (pdf/images) as clickable hrefs. */
function safeAttachmentUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  if (/^https:\/\//i.test(url)) return url;
  if (/^data:(application\/pdf|image\/(png|jpe?g|webp|gif));base64,[A-Za-z0-9+/=]+$/i.test(url)) return url;
  return null;
}

function LeaveAttachmentsPanel({ leaveRequestId }: { leaveRequestId: number }) {
  const { t } = useLanguage();
  const { data: detail, isLoading } = useGetLeaveRequest(leaveRequestId);
  const attachments = (detail as any)?.attachments ?? [];

  if (isLoading) return <Skeleton className="h-10 w-full" />;
  if (!attachments.length) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Paperclip className="w-3 h-3" />
        {t('No attachments provided', 'لا توجد مرفقات')}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
        <Paperclip className="w-3 h-3" />
        {t('Attachments', 'المرفقات')} ({attachments.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {attachments.map((att: any) => (
          <div key={att.id} className="flex items-center gap-2 p-2 rounded border bg-background text-sm">
            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span className="truncate max-w-[240px]" title={att.fileName}>{att.fileName}</span>
            {att.fileSize != null && (
              <span className="text-xs text-muted-foreground">({(att.fileSize / 1024).toFixed(0)} KB)</span>
            )}
            {safeAttachmentUrl(att.fileUrl) && (
              <a
                href={safeAttachmentUrl(att.fileUrl)!}
                download={att.fileName}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline flex items-center gap-1 text-xs"
                onClick={e => e.stopPropagation()}
              >
                <Download className="w-3 h-3" />
                {t('View', 'عرض')}
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Approvals() {
  const { t, lang } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Server enforces the same check; this only hides buttons the user can't use.
  const canDecide = user?.permissions?.includes('approvals.decide') ?? false;
  const { data: approvalsData, isLoading } = useListApprovals();
  const decideApproval = useDecideApproval();
  
  const [rejectDialogId, setRejectDialogId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'leave': return Calendar;
      case 'transfer': return ArrowLeftRight;
      case 'promotion': return TrendingUp;
      case 'document': return FileText;
      case 'equipment': return Wrench;
      case 'attendance_correction': return Clock;
      default: return FileText;
    }
  };

  const handleApprove = async (id: number) => {
    setDecidingId(id);
    try {
      await decideApproval.mutateAsync({
        id,
        data: { status: 'approved' },
      });
      
      toast({ 
        title: t('Success', 'نجاح'), 
        description: t('Approval request approved', 'تمت الموافقة على الطلب') 
      });
      queryClient.invalidateQueries({ queryKey: ['listApprovals'] });
    } catch (error: any) {
      toast({ 
        title: t('Error', 'خطأ'), 
        description: error.message || t('Failed to approve request', 'فشل في الموافقة على الطلب'), 
        variant: 'destructive' 
      });
    } finally {
      setDecidingId(null);
    }
  };

  const handleReject = async (id: number, note?: string) => {
    setDecidingId(id);
    try {
      await decideApproval.mutateAsync({
        id,
        data: { status: 'rejected', decisionNote: note },
      });
      
      toast({ 
        title: t('Success', 'نجاح'), 
        description: t('Approval request rejected', 'تم رفض الطلب') 
      });
      queryClient.invalidateQueries({ queryKey: ['listApprovals'] });
      setRejectDialogId(null);
      setRejectNote('');
    } catch (error: any) {
      toast({ 
        title: t('Error', 'خطأ'), 
        description: error.message || t('Failed to reject request', 'فشل في رفض الطلب'), 
        variant: 'destructive' 
      });
    } finally {
      setDecidingId(null);
    }
  };

  const isDueDateOverdue = (dueDate: string | null) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  };

  const isDueDateSoon = (dueDate: string | null) => {
    if (!dueDate) return false;
    const diff = new Date(dueDate).getTime() - new Date().getTime();
    return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000; // within 7 days
  };

  const pendingApprovals = approvalsData?.filter(a => a.status === 'pending') || [];
  const approvedApprovals = approvalsData?.filter(a => a.status === 'approved') || [];
  const rejectedApprovals = approvalsData?.filter(a => a.status === 'rejected') || [];
  
  const criticalCount = pendingApprovals.filter(a => a.priority === 'critical').length;
  const overdueCount = pendingApprovals.filter(a => a.dueDate && isDueDateOverdue(a.dueDate)).length;

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
              <TableHead className="w-12"></TableHead>
              <TableHead>{t('Request', 'الطلب')}</TableHead>
              <TableHead>{t('Requester', 'مقدم الطلب')}</TableHead>
              <TableHead>{t('Type', 'النوع')}</TableHead>
              <TableHead>{t('Priority', 'الأولوية')}</TableHead>
              <TableHead>{t('Date', 'التاريخ')}</TableHead>
              {filterStatus === 'pending' && canDecide && <TableHead className="text-end">{t('Action', 'الإجراء')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(item => {
              const TypeIcon = getTypeIcon(item.type);
              const isOverdue = item.dueDate && isDueDateOverdue(item.dueDate);
              const isSoon = item.dueDate && isDueDateSoon(item.dueDate);

              return (
                <Fragment key={item.id}>
                  <TableRow 
                    className={cn(
                      "cursor-pointer hover:bg-muted/50 transition-colors",
                      isOverdue && "bg-destructive/5 border-s-2 border-destructive"
                    )}
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  >
                    <TableCell>
                      <ChevronDown 
                        className={cn(
                          "w-4 h-4 text-muted-foreground transition-transform",
                          expandedId === item.id && "rotate-180"
                        )}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <TypeIcon className="w-4 h-4 text-muted-foreground" />
                        <span>{localName(item.titleEn, item.titleAr, lang)}</span>
                      </div>
                    </TableCell>
                    <TableCell>{item.requestedByEmployeeNameEn}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {item.type.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{getPriorityBadge(item.priority)}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm text-muted-foreground">
                          {new Date(item.createdAt).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US')}
                        </p>
                        {item.dueDate && (
                          <span className={cn(
                            "text-xs flex items-center gap-1",
                            isOverdue ? "text-destructive font-semibold" : isSoon ? "text-amber-500" : "text-muted-foreground"
                          )}>
                            <Clock className="w-3 h-3" />
                            {t('Due', 'مستحق')}: {new Date(item.dueDate).toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'en-US')}
                            {isOverdue && <Badge variant="destructive" className="text-xs ms-1">{t('Overdue', 'متأخر')}</Badge>}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {filterStatus === 'pending' && canDecide && (
                      <TableCell className="text-end" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="text-destructive border-destructive/30 hover:bg-destructive/10"
                            disabled={decidingId === item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRejectDialogId(item.id);
                            }}
                          >
                            <XSquare className="w-4 h-4 me-1" />
                            {t('Reject', 'رفض')}
                          </Button>
                          <Button 
                            size="sm" 
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            disabled={decidingId === item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApprove(item.id);
                            }}
                          >
                            <CheckSquare className="w-4 h-4 me-1" />
                            {t('Approve', 'موافقة')}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>

                  {/* Expanded Details Row */}
                  <AnimatePresence>
                    {expandedId === item.id && (
                      <TableRow>
                        <TableCell colSpan={filterStatus === 'pending' ? 7 : 6} className="bg-muted/30 p-0">
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="p-4 space-y-3">
                              <h4 className="font-semibold text-sm">{t('Request Details', 'تفاصيل الطلب')}</h4>
                              {(() => {
                                const meta = parseMetadata(item.metadata);
                                const leaveRequestId = item.type === 'leave' && meta
                                  ? Number(meta.leave_request_id ?? meta.leaveRequestId) || null
                                  : null;
                                return (
                                  <>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                                      {meta && Object.entries(meta).map(([key, value]) => (
                                        <div key={key} className="p-2 rounded bg-background border">
                                          <p className="text-xs text-muted-foreground capitalize mb-1">
                                            {key.replace(/_/g, ' ')}
                                          </p>
                                          <p className="font-medium truncate">{String(value)}</p>
                                        </div>
                                      ))}
                                    </div>
                                    {leaveRequestId && (
                                      <div className="p-3 rounded bg-background border">
                                        <LeaveAttachmentsPanel leaveRequestId={leaveRequestId} />
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                              {item.decisionNote && (
                                <div className="p-3 rounded bg-background border">
                                  <p className="text-xs text-muted-foreground mb-1">{t('Decision Note', 'ملاحظة القرار')}</p>
                                  <p className="text-sm">{item.decisionNote}</p>
                                </div>
                              )}
                              {(item.status === 'approved' || item.status === 'rejected') && (
                                <div className="p-3 rounded bg-background border">
                                  <p className="text-xs text-muted-foreground mb-1">
                                    {t('Decision by', 'قرار من')}: {item.assignedToUserName || '-'}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {t('On', 'في')}: {item.decidedAt ? new Date(item.decidedAt).toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-US') : '-'}
                                  </p>
                                  {item.decisionNote && (
                                    <p className="text-sm mt-2">{item.decisionNote}</p>
                                  )}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        </TableCell>
                      </TableRow>
                    )}
                  </AnimatePresence>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  return (
    <AnimatedPage className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('Workflow Approvals', 'موافقات سير العمل')}</h1>
        <p className="text-muted-foreground mt-1">
          {t('Review and decide on operational requests.', 'مراجعة واتخاذ قرار بشأن الطلبات التشغيلية.')}
        </p>
      </div>

      {/* Summary Stats Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-2xl font-bold">{pendingApprovals.length}</p>
              <p className="text-sm text-muted-foreground">{t('Total Pending', 'إجمالي قيد الانتظار')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{criticalCount}</p>
              <p className="text-sm text-muted-foreground">{t('Critical Priority', 'أولوية حرجة')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{overdueCount}</p>
              <p className="text-sm text-muted-foreground">{t('Overdue', 'متأخر')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            {t('Pending', 'قيد الانتظار')}
            {pendingApprovals.length > 0 && (
              <Badge variant="secondary" className="ms-1">{pendingApprovals.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved">{t('Approved', 'تمت الموافقة')}</TabsTrigger>
          <TabsTrigger value="rejected">{t('Rejected', 'مرفوض')}</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">{renderTable('pending')}</TabsContent>
        <TabsContent value="approved">{renderTable('approved')}</TabsContent>
        <TabsContent value="rejected">{renderTable('rejected')}</TabsContent>
      </Tabs>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialogId} onOpenChange={(open) => !open && setRejectDialogId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('Reject Approval Request', 'رفض طلب الموافقة')}</DialogTitle>
            <DialogDescription>
              {t('Provide an optional note explaining the reason for rejection.', 'قدم ملاحظة اختيارية توضح سبب الرفض.')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('Rejection Note (Optional)', 'ملاحظة الرفض (اختياري)')}</label>
              <Textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder={t('Add a reason for rejection...', 'أضف سببًا للرفض...')}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogId(null)}>
              {t('Cancel', 'إلغاء')}
            </Button>
            <Button 
              variant="destructive"
              onClick={() => rejectDialogId && handleReject(rejectDialogId, rejectNote)}
              disabled={decidingId === rejectDialogId}
            >
              {decidingId === rejectDialogId ? t('Rejecting...', 'جارٍ الرفض...') : t('Reject', 'رفض')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}
