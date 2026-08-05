import { useLanguage } from '@/hooks/use-language';
import { localName } from '@/lib/localise';
import { useListAlerts, useAcknowledgeAlert } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertOctagon, AlertTriangle, Info, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Alerts() {
  const { t, lang } = useLanguage();
  const { data: alertsData, isLoading } = useListAlerts();
  const acknowledgeAlert = useAcknowledgeAlert();

  const getSeverityIcon = (severity: string) => {
    switch(severity) {
      case 'critical': return <AlertOctagon className="w-6 h-6 text-destructive" />;
      case 'high': return <AlertTriangle className="w-6 h-6 text-orange-500" />;
      case 'medium': return <Info className="w-6 h-6 text-amber-500" />;
      case 'low': return <Info className="w-6 h-6 text-blue-500" />;
      default: return <Info className="w-6 h-6 text-muted-foreground" />;
    }
  };

  const getCardStyle = (severity: string, acknowledged: boolean) => {
    if (acknowledged) return "opacity-60 bg-muted/30";
    switch(severity) {
      case 'critical': return "border-destructive/50 bg-destructive/5 shadow-[0_0_15px_rgba(220,38,38,0.1)]";
      case 'high': return "border-orange-500/50 bg-orange-500/5";
      default: return "bg-card";
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-destructive flex items-center gap-3">
            <ShieldAlert className="w-8 h-8" />
            {t('Security Alerts', 'التنبيهات الأمنية')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('System anomalies, unauthorized access attempts, and compliance violations.', 'شذوذ النظام ومحاولات الوصول غير المصرح بها وانتهاكات الامتثال.')}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : !alertsData || alertsData.length === 0 ? (
          <div className="text-center py-16 border rounded-lg border-dashed text-muted-foreground bg-muted/10">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-500 opacity-50" />
            <h3 className="text-lg font-medium text-foreground mb-1">{t('All Clear', 'الوضع آمن')}</h3>
            <p>{t('No active security alerts.', 'لا توجد تنبيهات أمنية نشطة.')}</p>
          </div>
        ) : (
          alertsData.map(alert => (
            <Card key={alert.id} className={`transition-all duration-300 ${getCardStyle(alert.severity, alert.acknowledged)}`}>
              <CardContent className="p-6">
                <div className="flex gap-4 items-start">
                  <div className="shrink-0 mt-1">
                    {getSeverityIcon(alert.severity)}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-start">
                      <h3 className="text-lg font-semibold leading-none tracking-tight">
                        {localName(alert.titleEn, alert.titleAr, lang)}
                      </h3>
                      {!alert.acknowledged && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8 text-xs font-semibold uppercase tracking-wider"
                          onClick={() => acknowledgeAlert.mutate({ id: alert.id, data: { acknowledgedByUserId: 1 } })}
                          disabled={acknowledgeAlert.isPending}
                        >
                          {t('Acknowledge', 'إقرار')}
                        </Button>
                      )}
                      {alert.acknowledged && (
                        <Badge variant="outline" className="bg-background text-muted-foreground font-normal">
                          {t('Acknowledged by', 'تم الإقرار بواسطة')} {alert.acknowledgedByUserName}
                        </Badge>
                      )}
                    </div>
                    <p className={`text-sm ${alert.acknowledged ? 'text-muted-foreground' : 'text-foreground/80'}`}>
                      {localName(alert.descriptionEn, alert.descriptionAr, lang)}
                    </p>
                    <div className="flex items-center gap-3 mt-4 text-xs font-mono text-muted-foreground pt-4 border-t border-border/50">
                      <span>ID: ALT-{alert.id.toString().padStart(4, '0')}</span>
                      <span>•</span>
                      <span>CAT: {alert.category.toUpperCase()}</span>
                      <span>•</span>
                      <span>{new Date(alert.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
