import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Lang = 'en' | 'ar';

const STORAGE_KEY = 'hrms-mobile-lang';

const strings = {
  appName: { en: 'HRMS Command', ar: 'قيادة الموارد البشرية' },
  login: { en: 'Sign In', ar: 'تسجيل الدخول' },
  username: { en: 'Username', ar: 'اسم المستخدم' },
  password: { en: 'Password', ar: 'كلمة المرور' },
  loginHint: {
    en: 'Use your HRMS Command account',
    ar: 'استخدم حساب قيادة الموارد البشرية الخاص بك',
  },
  loginError: { en: 'Invalid credentials', ar: 'بيانات اعتماد غير صالحة' },
  lockoutError: {
    en: 'Too many failed login attempts. Please try again later.',
    ar: 'عدد كبير جدًا من محاولات تسجيل الدخول الفاشلة. يرجى المحاولة مرة أخرى لاحقًا.',
  },
  home: { en: 'My Space', ar: 'مساحتي' },
  approvals: { en: 'Approvals', ar: 'الموافقات' },
  announcements: { en: 'Announcements', ar: 'الإعلانات' },
  leaveBalances: { en: 'Leave Balances', ar: 'أرصدة الإجازات' },
  myLeaveRequests: { en: 'My Leave Requests', ar: 'طلبات إجازتي' },
  payslips: { en: 'Payslips', ar: 'قسائم الرواتب' },
  newLeaveRequest: { en: 'New Leave Request', ar: 'طلب إجازة جديد' },
  requestLeave: { en: 'Request Leave', ar: 'طلب إجازة' },
  leaveType: { en: 'Leave Type', ar: 'نوع الإجازة' },
  startDate: { en: 'Start Date', ar: 'تاريخ البدء' },
  endDate: { en: 'End Date', ar: 'تاريخ الانتهاء' },
  totalDays: { en: 'Total Days', ar: 'إجمالي الأيام' },
  reason: { en: 'Reason (optional)', ar: 'السبب (اختياري)' },
  submit: { en: 'Submit Request', ar: 'إرسال الطلب' },
  submitting: { en: 'Submitting…', ar: 'جارٍ الإرسال…' },
  submitted: { en: 'Leave request submitted', ar: 'تم إرسال طلب الإجازة' },
  invalidDates: {
    en: 'Enter valid dates (YYYY-MM-DD), end after start',
    ar: 'أدخل تواريخ صالحة (YYYY-MM-DD)، النهاية بعد البداية',
  },
  selectLeaveType: { en: 'Select a leave type', ar: 'اختر نوع الإجازة' },
  pending: { en: 'Pending', ar: 'قيد الانتظار' },
  approved: { en: 'Approved', ar: 'موافق عليه' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
  approve: { en: 'Approve', ar: 'موافقة' },
  reject: { en: 'Reject', ar: 'رفض' },
  available: { en: 'available', ar: 'متاح' },
  used: { en: 'used', ar: 'مستخدم' },
  days: { en: 'days', ar: 'يوم' },
  net: { en: 'Net', ar: 'صافي' },
  gross: { en: 'Gross', ar: 'إجمالي' },
  deductions: { en: 'Deductions', ar: 'الاستقطاعات' },
  pendingQueue: { en: 'Pending Approval Queue', ar: 'قائمة الموافقات المعلقة' },
  noPending: { en: 'No pending approvals', ar: 'لا توجد موافقات معلقة' },
  noAnnouncements: { en: 'No announcements', ar: 'لا توجد إعلانات' },
  noPayslips: { en: 'No payslips yet', ar: 'لا توجد قسائم رواتب بعد' },
  noRequests: { en: 'No leave requests yet', ar: 'لا توجد طلبات إجازة بعد' },
  noBalances: { en: 'No leave balances found', ar: 'لم يتم العثور على أرصدة' },
  loadFailed: { en: 'Failed to load', ar: 'فشل التحميل' },
  retry: { en: 'Retry', ar: 'إعادة المحاولة' },
  signOut: { en: 'Sign Out', ar: 'تسجيل الخروج' },
  requestedBy: { en: 'Requested by', ar: 'مقدم الطلب' },
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  noEmployee: {
    en: 'This account is not linked to an employee record.',
    ar: 'هذا الحساب غير مرتبط بسجل موظف.',
  },
  updatedLive: { en: 'Auto-refreshing', ar: 'تحديث تلقائي' },
} as const;

export type StringKey = keyof typeof strings;

interface I18nContextValue {
  lang: Lang;
  isRTL: boolean;
  t: (key: StringKey) => string;
  toggleLang: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'ar' || v === 'en') setLang(v);
    });
  }, []);

  const toggleLang = useCallback(() => {
    setLang((prev) => {
      const next: Lang = prev === 'en' ? 'ar' : 'en';
      AsyncStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      isRTL: lang === 'ar',
      t: (key: StringKey) => strings[key][lang],
      toggleLang,
    }),
    [lang, toggleLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
