import React from 'react';
import { Link, useLocation } from 'wouter';
import { useLanguage } from '@/hooks/use-language';
import { GridMindIconMark } from '@/components/brand/Logo';
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
  Shield,
  MapPin,
  ArrowRightLeft,
  Lock,
  Activity,
  Server,
  SlidersVertical,
  Briefcase,
  ClipboardList,
  GraduationCap,
  BarChart3,
  Target,
  User,
  FolderOpen,
  BarChart2,
  Bell,
  FileText,
  ClipboardCheck,
  FileBarChart,
  Brain,
  Rocket,
  Upload,
  PlayCircle,
  Building2,
  Palette,
  Globe,
  GitBranch,
  Package,
  Gauge,
  ShieldAlert,
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
    { href: '/attendance-gateway', icon: Server, labelEn: 'Attendance Gateway', labelAr: 'بوابة الحضور' },
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

  const militaryItems = [
    { href: '/system-config', icon: SlidersVertical, labelEn: 'System Config', labelAr: 'إعدادات النظام' },
    { href: '/military-hierarchy', icon: Shield, labelEn: 'Military Hierarchy', labelAr: 'الهيكل العسكري' },
    { href: '/duty-stations', icon: MapPin, labelEn: 'Duty Stations', labelAr: 'محطات الخدمة' },
    { href: '/postings', icon: ArrowRightLeft, labelEn: 'Postings & Transfers', labelAr: 'التكليفات والنقل' },
    { href: '/security-clearances', icon: ShieldCheck, labelEn: 'Security Clearances', labelAr: 'التصاريح الأمنية' },
    { href: '/mobilization', icon: Activity, labelEn: 'Mobilization', labelAr: 'التعبئة' },
    { href: '/security-settings', icon: Lock, labelEn: 'Security Settings', labelAr: 'إعدادات الأمان' },
  ];

  const systemAdminItems = [
    { href: '/admin-airgap', icon: Server, labelEn: 'Air-Gap Admin', labelAr: 'إدارة الفصل الجوي' },
  ];

  const recruitmentItems = [
    { href: '/recruitment', icon: Briefcase, labelEn: 'Recruitment', labelAr: 'التوظيف' },
  ];

  const onboardingDevItems = [
    { href: '/onboarding', icon: ClipboardList, labelEn: 'Onboarding', labelAr: 'الاستقطاب' },
    { href: '/probation', icon: Clock, labelEn: 'Probation', labelAr: 'فترة التجربة' },
    { href: '/training', icon: GraduationCap, labelEn: 'Training', labelAr: 'التدريب' },
    { href: '/skills', icon: BarChart3, labelEn: 'Skills', labelAr: 'المهارات' },
  ];

  const performanceItems = [
    { href: '/performance', icon: Target, labelEn: 'Performance', labelAr: 'الأداء' },
    { href: '/disciplinary', icon: AlertTriangle, labelEn: 'Disciplinary', labelAr: 'التأديب' },
    { href: '/succession', icon: TrendingUp, labelEn: 'Succession', labelAr: 'التخطيط الوظيفي' },
  ];

  const selfServiceItems = [
    { href: '/my', icon: User, labelEn: 'My Portal', labelAr: 'بوابتي' },
    { href: '/manager', icon: Users, labelEn: 'Manager Portal', labelAr: 'بوابة المدير' },
  ];

  const docsReportsItems = [
    { href: '/document-management', icon: FolderOpen, labelEn: 'Document Management', labelAr: 'إدارة المستندات' },
    { href: '/reports', icon: BarChart2, labelEn: 'Reports & Analytics', labelAr: 'التقارير والتحليلات' },
  ];

  const systemPhase6Items = [
    { href: '/notifications', icon: Bell, labelEn: 'Notifications', labelAr: 'الإشعارات' },
    { href: '/production-health', icon: Gauge, labelEn: 'Production Health', labelAr: 'صحة الإنتاج', highlight: true },
    { href: '/deployment', icon: Activity, labelEn: 'Deployment & Health', labelAr: 'النشر والصحة' },
    { href: '/production-readiness', icon: ClipboardCheck, labelEn: 'Readiness', labelAr: 'الجاهزية' },
    { href: '/local-ai', icon: Brain, labelEn: 'Local AI Assistant', labelAr: 'مساعد الذكاء الاصطناعي المحلي' },
    { href: '/setup-wizard', icon: Rocket, labelEn: 'Setup Wizard', labelAr: 'معالج الإعداد' },
    { href: '/diagnostics', icon: Activity, labelEn: 'System Diagnostics', labelAr: 'تشخيص النظام' },
    { href: '/go-live-checklist', icon: CheckSquare, labelEn: 'Go-Live Checklist', labelAr: 'قائمة الإطلاق' },
    { href: '/licensing', icon: Shield, labelEn: 'Licensing', labelAr: 'الترخيص' },
  ];

  const pilotImportItems = [
    { href: '/data-import', icon: Upload, labelEn: 'Data Import', labelAr: 'استيراد البيانات' },
    { href: '/pilot', icon: PlayCircle, labelEn: 'Pilot Scenarios', labelAr: 'سيناريوهات تجريبية' },
  ];

  const pilotQAItems = [
    { href: '/pilot-control-center', icon: Gauge, labelEn: 'Pilot Control Center', labelAr: 'مركز التحكم التجريبي', highlight: true },
    { href: '/readiness', icon: ClipboardList, labelEn: 'Readiness Report', labelAr: 'تقرير الجاهزية', highlight: false },
    { href: '/uat-scripts', icon: ClipboardCheck, labelEn: 'UAT Scripts', labelAr: 'نصوص قبول المستخدم', highlight: false },
    { href: '/security-tests', icon: ShieldAlert, labelEn: 'Security Tests', labelAr: 'اختبارات الأمان', highlight: false },
  ];

  const analyticsItems = [
    { href: '/workforce-analytics', icon: BarChart3, labelEn: 'Workforce Analytics', labelAr: 'تحليلات القوى العاملة' },
    { href: '/report-builder', icon: FileBarChart, labelEn: 'Report Builder', labelAr: 'منشئ التقارير' },
  ];

  const integrationsItems = [
    { href: '/integration-center', icon: Network, labelEn: 'Integration Center', labelAr: 'مركز التكامل' },
    { href: '/integration-governance', icon: ShieldCheck, labelEn: 'Integration Governance', labelAr: 'حوكمة التكامل' },
  ];

  const multiOrgPolicyItems = [
    { href: '/organizations', icon: Building2, labelEn: 'Organizations', labelAr: 'المؤسسات' },
    { href: '/org-branding', icon: Palette, labelEn: 'White-Label', labelAr: 'الهوية البصرية' },
    { href: '/policy-localization', icon: Globe, labelEn: 'Policy Localization', labelAr: 'السياسات المحلية' },
    { href: '/policy-governance', icon: GitBranch, labelEn: 'Policy Governance', labelAr: 'حوكمة السياسات' },
  ];

  const configPackagesItems = [
    { href: '/config-packages', icon: Package, labelEn: 'Config Packages', labelAr: 'حزم الإعدادات' },
  ];

  const comingSoonItems: { icon: React.ComponentType<{ className?: string }>; labelEn: string; labelAr: string }[] = [];

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
        <div className="flex items-center gap-2.5">
          <GridMindIconMark size={32} />
          <span className="font-semibold text-sm tracking-tight leading-none">
            <span className="text-sidebar-foreground">GridMind</span>
            <span className="text-[#22C55E]">HR</span>
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
          {t('Military & Government', 'عسكري وحكومي')}
        </div>
        {militaryItems.map((item) => {
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
          {t('System Admin', 'إدارة النظام')}
        </div>
        {systemAdminItems.map((item) => {
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
          {t('Recruitment', 'التوظيف')}
        </div>
        {recruitmentItems.map((item) => {
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
          {t('Onboarding & Development', 'الاستقطاب والتطوير')}
        </div>
        {onboardingDevItems.map((item) => {
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
          {t('Performance', 'الأداء')}
        </div>
        {performanceItems.map((item) => {
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
          {t('Self Service', 'الخدمة الذاتية')}
        </div>
        {selfServiceItems.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <FileText className="w-3 h-3" />
            {t('Documents & Reports', 'المستندات والتقارير')}
          </span>
        </div>
        {docsReportsItems.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <BarChart3 className="w-3 h-3" />
            {t('Analytics', 'التحليلات')}
          </span>
        </div>
        {analyticsItems.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <Network className="w-3 h-3" />
            {t('Integrations', 'التكاملات')}
          </span>
        </div>
        {integrationsItems.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <Building2 className="w-3 h-3" />
            {t('Multi-Org & Policy', 'المؤسسات والسياسات')}
          </span>
        </div>
        {multiOrgPolicyItems.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <Package className="w-3 h-3" />
            {t('Config Packages', 'حزم الإعدادات')}
          </span>
        </div>
        {configPackagesItems.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <Server className="w-3 h-3" />
            {t('System', 'النظام')}
          </span>
        </div>
        {systemPhase6Items.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <PlayCircle className="w-3 h-3" />
            {t('Pilot & Import', 'تجريبي واستيراد')}
          </span>
        </div>
        {pilotImportItems.map((item) => {
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
          <span className="flex items-center gap-1.5">
            <Gauge className="w-3 h-3 text-amber-400" />
            <span className="text-amber-400">{t('Pilot & QA', 'تجريبي وضمان الجودة')}</span>
          </span>
        </div>
        {pilotQAItems.map((item) => {
          const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href} onClick={onMobileClose}>
              <div className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer relative",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-s-[3px] border-primary"
                  : item.highlight
                    ? "text-amber-400 hover:bg-sidebar-accent/50 hover:text-amber-300"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}>
                <item.icon className={cn("w-4 h-4", item.highlight && !isActive && "text-amber-400")} />
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
