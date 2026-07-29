import { useLanguage } from '@/hooks/use-language';
import { useListDocuments, useCreateDocument, useGetDocument, useUpdateDocument, useDeleteDocument, getGetDocumentQueryKey } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Search, Filter, Download, MoreHorizontal } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Documents() {
  const { t, lang } = useLanguage();
  const { data: documentsData, isLoading } = useListDocuments();
  const createDocument = useCreateDocument();
  const updateDocument = useUpdateDocument();
  const deleteDocument = useDeleteDocument();
  const { data: documentDetail } = useGetDocument(1, { query: { enabled: false, queryKey: getGetDocumentQueryKey(1) } });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">{t('Active', 'نشط')}</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20">{t('Pending Review', 'قيد المراجعة')}</Badge>;
      case 'expired':
        return <Badge variant="destructive">{t('Expired', 'منتهي')}</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const isExpiringSoon = (dateStr: string | null | undefined) => {
    if (!dateStr) return false;
    const expiry = new Date(dateStr);
    const today = new Date();
    const diffTime = Math.abs(expiry.getTime() - today.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays <= 30 && expiry > today;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('Document Repository', 'مستودع المستندات')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('Centralized secure storage for employee and institutional records.', 'تخزين مركزي آمن لسجلات الموظفين والمؤسسة.')}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="py-4 border-b flex flex-row items-center justify-between">
           <div className="flex gap-4 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder={t('Search documents...', 'البحث في المستندات...')}
                className="ps-9"
              />
            </div>
            <Button variant="outline" className="shrink-0">
              <Filter className="w-4 h-4 me-2" />
              {t('Category Filter', 'تصفية حسب الفئة')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[300px]">{t('Document Name', 'اسم المستند')}</TableHead>
                <TableHead>{t('Employee', 'الموظف')}</TableHead>
                <TableHead>{t('Category', 'الفئة')}</TableHead>
                <TableHead>{t('Status', 'الحالة')}</TableHead>
                <TableHead>{t('Expiry Date', 'تاريخ الانتهاء')}</TableHead>
                <TableHead className="text-end">{t('Actions', 'الإجراءات')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 ms-auto" /></TableCell>
                  </TableRow>
                ))
              ) : !documentsData || documentsData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {t('No documents found.', 'لم يتم العثور على مستندات.')}
                  </TableCell>
                </TableRow>
              ) : (
                documentsData.map((doc) => {
                  const expiring = isExpiringSoon(doc.expiresAt);
                  return (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-primary" />
                        </div>
                        <span className="truncate max-w-[200px]" title={lang === 'en' ? doc.titleEn : doc.titleAr}>
                          {lang === 'en' ? doc.titleEn : doc.titleAr}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {doc.employeeNameEn}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{doc.category}</Badge>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(doc.status)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {doc.expiresAt ? new Date(doc.expiresAt).toLocaleDateString() : '-'}
                          {expiring && (
                            <div className="w-2 h-2 rounded-full bg-amber-500" title={t('Expiring soon', 'سينتهي قريباً')} />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="icon">
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
