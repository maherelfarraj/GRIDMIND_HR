import { Link, useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/hooks/use-auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
  UserPlus,
  LogOut,
  X,
  Timer,
  CalendarDays,
  TrendingUp,
  Fingerprint,
  Wallet,
  SlidersHorizontal,
  Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ isMobileOpen = false, onMobileClose }: SidebarProps) {
  const [location] = useLocation();
  const { t, lang } = useLanguage();
  const { user, logout } = useAuth();

  const navItems = [
    { href: '/', icon: LayoutDashboard, labelEn: 'Dashboard', labelAr: 'لوحة القيادة' },
    { href: '/employees', icon: Users, labelEn: 'Directory', labelAr: 'الدليل' },
    { href: '/departments', icon: Network, labelEn: 'Organization', labelAr: 'المنظمة' },
    { href: '/roles', icon: ShieldCheck, labelEn: 'Roles', labelAr: 'الأدوار' },
    { href: '/documents', icon: Files, labelEn: 'Documents', labelAr: 'المستندات' },
    { href: '/approvals', icon: CheckSquare, labelEn: 'Approvals', labelAr: 'الموافقات' },
    { href: '/attendance', icon: Clock, labelEn: 'Attendance', labelAr: 'الحضور' },
    { href: '/shifts', icon: Timer, labelEn: 'Shifts', labelAr: 'الورديات' },
    { href: '/rosters', icon: CalendarDays, labelEn: 'Roster', labelAr: 'الجدول الزمني' },
    { href: '/overtime', icon: TrendingUp, labelEn: 'Overtime', labelAr: 'الوقت الإضافي' },
    { href: '/punch-events', icon: Fingerprint, labelEn: 'Punch Log', labelAr: 'سجل البصمة' },
    { href: '/devices', icon: Cpu, labelEn: 'Devices', labelAr: 'الأجهزة' },
    { href: '/audit', icon: History, labelEn: 'Audit Log', labelAr: 'سجل التدقيق' },
    { href: '/alerts', icon: AlertTriangle, labelEn: 'Alerts', labelAr: 'التنبيهات' },
    { href: '/users', icon: Settings, labelEn: 'System Users', labelAr: 'مستخدمي النظام' },
  ];

  const leaveItems = [
    { href: '/leave', icon: CalendarOff, labelEn: 'Leave Requests', labelAr: 'طلبات الإجازة' },
    { href: '/leave-balances', icon: CalendarDays, labelEn: 'Leave Balances', labelAr: 'أرصدة الإجازات' },
    { href: '/leave-config', icon: SlidersHorizontal, labelEn: 'Leave Config', labelAr: 'إعداد الإجازات' },
  ];

  const payrollItems = [
    { href: '/payroll', icon: Banknote, labelEn: 'Payroll Periods', labelAr: 'فترات الرواتب' },
    { href: '/payroll/grades', icon: Wallet, labelEn: 'Salary Grades', labelAr: 'الدرجات الوظيفية' },
    { href: '/payroll/components', icon: Receipt, labelEn: 'Pay Components', labelAr: 'مكونات الراتب' },
  ];

  const comingSoonItems = [
    { icon: UserPlus, labelEn: 'Recruitment', labelAr: 'التوظيف' },
  ];

  const userInitials = user ? (lang === 'en' ? user.fullNameEn : user.fullNameAr)
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() : 'U';

  return (
    <aside className={cn(
      "w-64 border-e border-border bg-sidebar text-sidebar-foreground flex flex-col flex-shrink-0 transition-transform duration-200",
      // Desktop: normal static flow
      "hidden md:flex",
      // Mobile: fixed overlay
      isMobileOpen && "flex fixed inset-y-0 start-0 z-50"
    )}>
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border relative">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-bold tracking-wider uppercase text-sm">
            {t('HRMS Command', 'نظام الموارد')}
          </span>
        </div>
        
        {/* Mobile close button */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden absolute end-2 top-1/2 -translate-y-1/2"
          onClick={onMobileClose}
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
        <div className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
          {t('Core Modules', 'الوحدات الأساسية')}
        </div>
        
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} onClick={onMobileClose}>
              <div className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer relative",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-s-[3px] border-primary" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <item.icon className="w-4 h-4" />
                <span>{t(item.labelEn, item.labelAr)}</span>
              </div>
            </Link>
          );
        })}

        <div className="px-3 mt-6 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
          {t('Leave Management', 'إدارة الإجازات')}
        </div>
        {leaveItems.map((item) => {
          const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} onClick={onMobileClose}>
              <div className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer relative",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-s-[3px] border-primary" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <item.icon className="w-4 h-4" />
                <span>{t(item.labelEn, item.labelAr)}</span>
              </div>
            </Link>
          );
        })}

        <div className="px-3 mt-6 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
          {t('Payroll', 'الرواتب')}
        </div>
        {payrollItems.map((item) => {
          const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} onClick={onMobileClose}>
              <div className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer relative",
                isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-s-[3px] border-primary" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <item.icon className="w-4 h-4" />
                <span>{t(item.labelEn, item.labelAr)}</span>
              </div>
            </Link>
          );
        })}

        <div className="px-3 mt-6 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
          {t('Coming Soon', 'قريباً')}
        </div>
        {comingSoonItems.map((item) => (
          <div key={item.labelEn} className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground/30 cursor-not-allowed">
            <item.icon className="w-4 h-4" />
            <span className="flex-1">{t(item.labelEn, item.labelAr)}</span>
            <span className="text-[10px] bg-sidebar-accent px-1.5 py-0.5 rounded text-sidebar-foreground/50">
              {t('Soon', 'قريباً')}
            </span>
          </div>
        ))}
      </div>

      {/* User info card */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/20 text-primary font-semibold">
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {user ? (lang === 'en' ? user.fullNameEn : user.fullNameAr) : 'User'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user?.username || 'username'}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:border-destructive"
          onClick={logout}
        >
          <LogOut className="w-4 h-4" />
          {t('Sign Out', 'تسجيل الخروج')}
        </Button>
      </div>
    </aside>
  );
}
