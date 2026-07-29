import { Link, useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { 
  LayoutDashboard, 
  Users, 
  Network, 
  ShieldCheck, 
  Files, 
  CheckSquare, 
  History, 
  Clock, 
  Cpu, 
  AlertTriangle, 
  Settings,
  Banknote,
  CalendarOff,
  UserPlus
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const [location] = useLocation();
  const { t, lang } = useLanguage();

  const navItems = [
    { href: '/', icon: LayoutDashboard, labelEn: 'Dashboard', labelAr: 'لوحة القيادة' },
    { href: '/employees', icon: Users, labelEn: 'Directory', labelAr: 'الدليل' },
    { href: '/departments', icon: Network, labelEn: 'Organization', labelAr: 'المنظمة' },
    { href: '/roles', icon: ShieldCheck, labelEn: 'Roles', labelAr: 'الأدوار' },
    { href: '/documents', icon: Files, labelEn: 'Documents', labelAr: 'المستندات' },
    { href: '/approvals', icon: CheckSquare, labelEn: 'Approvals', labelAr: 'الموافقات' },
    { href: '/attendance', icon: Clock, labelEn: 'Attendance', labelAr: 'الحضور' },
    { href: '/devices', icon: Cpu, labelEn: 'Devices', labelAr: 'الأجهزة' },
    { href: '/audit', icon: History, labelEn: 'Audit Log', labelAr: 'سجل التدقيق' },
    { href: '/alerts', icon: AlertTriangle, labelEn: 'Alerts', labelAr: 'التنبيهات' },
    { href: '/users', icon: Settings, labelEn: 'System Users', labelAr: 'مستخدمي النظام' },
  ];

  const comingSoonItems = [
    { icon: Banknote, labelEn: 'Payroll', labelAr: 'الرواتب' },
    { icon: CalendarOff, labelEn: 'Leave Mgmt', labelAr: 'إدارة الإجازات' },
    { icon: UserPlus, labelEn: 'Recruitment', labelAr: 'التوظيف' },
  ];

  return (
    <aside className="w-64 border-e border-border bg-sidebar text-sidebar-foreground hidden md:flex flex-col flex-shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold tracking-wider uppercase text-sm">
            {t('HRMS Command', 'نظام الموارد')}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
        <div className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
          {t('Core Modules', 'الوحدات الأساسية')}
        </div>
        
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}>
              <div className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <item.icon className="w-4 h-4" />
                <span>{t(item.labelEn, item.labelAr)}</span>
              </div>
            </Link>
          );
        })}

        <div className="px-3 mt-8 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
          {t('Coming Soon', 'قريباً')}
        </div>
        
        {comingSoonItems.map((item) => (
          <div key={item.labelEn} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/30 cursor-not-allowed">
            <item.icon className="w-4 h-4" />
            <span className="flex-1">{t(item.labelEn, item.labelAr)}</span>
            <span className="text-[10px] bg-sidebar-accent px-1.5 py-0.5 rounded text-sidebar-foreground/50">
              {t('Beta', 'بيتا')}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
