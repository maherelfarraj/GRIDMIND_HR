import { useLanguage } from '@/hooks/use-language';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  const { t } = useLanguage();

  return (
    <div className="flex-1 flex items-center justify-center p-6 h-[calc(100vh-8rem)]">
      <Card className="w-full max-w-md bg-destructive/10 border-destructive/20 text-center py-12">
        <CardContent className="flex flex-col items-center space-y-4">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <h2 className="text-2xl font-bold tracking-tight">
            {t('Page Not Found', 'الصفحة غير موجودة')}
          </h2>
          <p className="text-muted-foreground">
            {t('The module or page you are looking for does not exist or you do not have permission to access it.', 'الوحدة أو الصفحة التي تبحث عنها غير موجودة أو ليس لديك الصلاحية للوصول إليها.')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
