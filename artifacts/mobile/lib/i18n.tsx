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
  selectDate: { en: 'Select date', ar: 'اختر التاريخ' },
  calendarHint: {
    en: 'Tap a start day, then an end day',
    ar: 'اضغط على يوم البداية ثم يوم النهاية',
  },
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
  payslipDetail: { en: 'Payslip', ar: 'قسيمة الراتب' },
  baseSalary: { en: 'Base Salary', ar: 'الراتب الأساسي' },
  employee: { en: 'Employee', ar: 'الموظف' },
  jobTitle: { en: 'Job Title', ar: 'المسمى الوظيفي' },
  department: { en: 'Department', ar: 'القسم' },
  sharePayslip: { en: 'Share Payslip', ar: 'مشاركة قسيمة الراتب' },
  shareFailed: {
    en: 'Could not share the payslip. Please try again.',
    ar: 'تعذّرت مشاركة قسيمة الراتب. يرجى المحاولة مرة أخرى.',
  },
  earnings: { en: 'Earnings', ar: 'الاستحقاقات' },
  netPay: { en: 'Net Pay', ar: 'صافي الراتب' },
  overtime: { en: 'Overtime', ar: 'العمل الإضافي' },
  hours: { en: 'hours', ar: 'ساعة' },
  payDate: { en: 'Pay Date', ar: 'تاريخ الصرف' },
  workingDays: { en: 'Working Days', ar: 'أيام العمل' },
  presentDays: { en: 'Present Days', ar: 'أيام الحضور' },
  exceptionNote: { en: 'Exception', ar: 'استثناء' },
  noLines: { en: 'No line items', ar: 'لا توجد بنود' },
  changePassword: { en: 'Change Password', ar: 'تغيير كلمة المرور' },
  currentPassword: { en: 'Current Password', ar: 'كلمة المرور الحالية' },
  newPassword: { en: 'New Password', ar: 'كلمة المرور الجديدة' },
  confirmNewPassword: {
    en: 'Confirm New Password',
    ar: 'تأكيد كلمة المرور الجديدة',
  },
  passwordsDoNotMatch: {
    en: 'New passwords do not match',
    ar: 'كلمتا المرور الجديدتان غير متطابقتين',
  },
  wrongCurrentPassword: {
    en: 'Current password is incorrect',
    ar: 'كلمة المرور الحالية غير صحيحة',
  },
  weakPassword: {
    en: 'New password does not meet the password requirements',
    ar: 'كلمة المرور الجديدة لا تفي بمتطلبات كلمة المرور',
  },
  changePasswordFailed: {
    en: 'Could not change password. Please try again.',
    ar: 'تعذر تغيير كلمة المرور. يرجى المحاولة مرة أخرى.',
  },
  passwordChanged: { en: 'Password changed', ar: 'تم تغيير كلمة المرور' },
  passwordChangedHint: {
    en: 'Use your new password the next time you sign in.',
    ar: 'استخدم كلمة المرور الجديدة عند تسجيل الدخول في المرة القادمة.',
  },
  passwordPolicyHint: {
    en: 'At least 8 characters, including at least 3 of: lowercase, uppercase, numbers, symbols.',
    ar: '8 أحرف على الأقل، تتضمن 3 أنواع على الأقل من: أحرف صغيرة، أحرف كبيرة، أرقام، رموز.',
  },
  done: { en: 'Done', ar: 'تم' },
  notifications: { en: 'Notifications', ar: 'الإشعارات' },
  noNotifications: { en: 'No notifications', ar: 'لا توجد إشعارات' },
  markAllRead: { en: 'Mark all read', ar: 'تعليم الكل كمقروء' },
  viewDevice: { en: 'View device', ar: 'عرض الجهاز' },
  devices: { en: 'Attendance Devices', ar: 'أجهزة الحضور' },
  noDevices: { en: 'No devices found', ar: 'لم يتم العثور على أجهزة' },
  deviceOnline: { en: 'Online', ar: 'متصل' },
  deviceOffline: { en: 'Offline', ar: 'غير متصل' },
  deviceStale: { en: 'Stale', ar: 'بيانات قديمة' },
  lastContact: { en: 'Last contact', ar: 'آخر اتصال' },
  deviceNoContact: { en: 'No contact', ar: 'لا اتصال' },
  deviceMarkedOnline: { en: 'marked online', ar: 'مسجل كمتصل' },
  never: { en: 'never', ar: 'أبدًا' },
  userAdmin: { en: 'User Management', ar: 'إدارة المستخدمين' },
  userAdminSubtitle: {
    en: 'System accounts & access',
    ar: 'حسابات النظام والوصول',
  },
  noUsers: { en: 'No users found', ar: 'لم يتم العثور على مستخدمين' },
  inactive: { en: 'Inactive', ar: 'غير نشط' },
  locked: { en: 'Locked', ar: 'مقفل' },
  unlock: { en: 'Unlock', ar: 'إلغاء القفل' },
  unlockFailed: { en: 'Failed to unlock account', ar: 'فشل إلغاء قفل الحساب' },
  mustChangePasswordBadge: {
    en: 'Must change password',
    ar: 'يجب تغيير كلمة المرور',
  },
  issueOtp: { en: 'Issue one-time password', ar: 'إصدار كلمة مرور لمرة واحدة' },
  issueOtpConfirmTitle: {
    en: 'Issue one-time password?',
    ar: 'إصدار كلمة مرور لمرة واحدة؟',
  },
  issueOtpConfirmBody: {
    en: 'This replaces the current password, signs the user out of all devices, and forces a password change at next login. The new password is shown only once.',
    ar: 'سيؤدي هذا إلى استبدال كلمة المرور الحالية وتسجيل خروج المستخدم من جميع الأجهزة وإجبار المستخدم على تغيير كلمة المرور عند تسجيل الدخول التالي. تُعرض كلمة المرور الجديدة مرة واحدة فقط.',
  },
  issueOtpFailed: {
    en: 'Could not issue a one-time password',
    ar: 'تعذر إصدار كلمة مرور لمرة واحدة',
  },
  otpIssuedTitle: { en: 'One-time password', ar: 'كلمة مرور لمرة واحدة' },
  otpIssuedShowOnce: {
    en: 'Shown only once — it is not stored anywhere. Share it securely with the user now.',
    ar: 'تُعرض مرة واحدة فقط — لا يتم تخزينها في أي مكان. شاركها بأمان مع المستخدم الآن.',
  },
  copy: { en: 'Copy', ar: 'نسخ' },
  copied: { en: 'Copied', ar: 'تم النسخ' },
  sessionReview: { en: 'Session Review', ar: 'مراجعة الجلسات' },
  sessionReviewSubtitle: {
    en: 'Break-glass privileged sessions',
    ar: 'جلسات وصول الطوارئ المميزة',
  },
  sessionReviewInfo: {
    en: 'Every break-glass activation records a privileged session. Security officers must review each elevated-access window post-hoc.',
    ar: 'كل تفعيل لوصول الطوارئ يسجل جلسة مميزة. يجب على ضباط الأمن مراجعة كل نافذة وصول مرتفع لاحقاً.',
  },
  awaitingReview: { en: 'Awaiting Review', ar: 'بانتظار المراجعة' },
  reviewedSessions: { en: 'Reviewed Sessions', ar: 'الجلسات المراجعة' },
  noSessionsPending: {
    en: 'No sessions awaiting review',
    ar: 'لا توجد جلسات بانتظار المراجعة',
  },
  noReviewedSessions: {
    en: 'No reviewed sessions yet',
    ar: 'لا توجد جلسات مراجعة بعد',
  },
  grant: { en: 'Grant', ar: 'التصريح' },
  started: { en: 'Started', ar: 'بدأت' },
  ended: { en: 'Ended', ar: 'انتهت' },
  openUntil: { en: 'Open until', ar: 'مفتوحة حتى' },
  outcomeJustified: { en: 'Justified', ar: 'مبرر' },
  outcomeUnjustified: { en: 'Unjustified', ar: 'غير مبرر' },
  outcomeUnderInvestigation: {
    en: 'Under Investigation',
    ar: 'قيد التحقيق',
  },
  notReviewed: { en: 'Not reviewed', ar: 'لم تُراجع' },
  sessionActivity: { en: 'Session Activity', ar: 'نشاط الجلسة' },
  sessionActivityHint: {
    en: 'Audit-log actions the session holder performed during the elevated-access window.',
    ar: 'إجراءات سجل التدقيق التي نفذها صاحب الجلسة خلال نافذة الوصول المرتفع.',
  },
  activityEstimateNotice: {
    en: 'Estimated by time window: this session predates precise activity tagging, so the list shows everything this user did during the window — routine work may be mixed in.',
    ar: 'مُقدَّر حسب النافذة الزمنية: هذه الجلسة تسبق التتبع الدقيق للنشاط، لذا تعرض القائمة كل ما قام به المستخدم خلال النافذة — وقد تتضمن أعمالاً اعتيادية.',
  },
  noSessionActivity: {
    en: 'No audit-log actions recorded during this session window.',
    ar: 'لم تُسجل أي إجراءات في سجل التدقيق خلال نافذة هذه الجلسة.',
  },
  activityLoadFailed: {
    en: 'Failed to load session activity.',
    ar: 'فشل تحميل نشاط الجلسة.',
  },
  loadMore: { en: 'Load more', ar: 'تحميل المزيد' },
  reviewSession: { en: 'Review Session', ar: 'مراجعة الجلسة' },
  reviewRecordedAs: {
    en: 'The review is recorded under your signed-in account.',
    ar: 'تُسجل المراجعة باسم حسابك المسجل.',
  },
  reviewOutcome: { en: 'Outcome', ar: 'النتيجة' },
  reviewNotes: { en: 'Notes (optional)', ar: 'ملاحظات (اختياري)' },
  markReviewed: {
    en: 'Mark Reviewed',
    ar: 'وضع علامة تمت المراجعة',
  },
  sessionReviewed: { en: 'Session reviewed', ar: 'تمت مراجعة الجلسة' },
  reviewFailed: { en: 'Failed to submit review', ar: 'فشل إرسال المراجعة' },
  sessionNotFound: { en: 'Session not found', ar: 'الجلسة غير موجودة' },
  passwordChangeRequiredHint: {
    en: 'Your account was set up with a one-time password. For security, you must choose a new password before continuing.',
    ar: 'تم إنشاء حسابك بكلمة مرور لمرة واحدة. لأسباب أمنية، يجب اختيار كلمة مرور جديدة قبل المتابعة.',
  },
  sessionExpiredNotice: {
    en: 'Your session has expired. Please sign in again.',
    ar: 'انتهت صلاحية جلستك. يرجى تسجيل الدخول مرة أخرى.',
  },
  upcomingHolidays: { en: 'Upcoming Holidays', ar: 'الإجازات الرسمية القادمة' },
  noUpcomingHolidays: {
    en: 'No upcoming public holidays',
    ar: 'لا توجد إجازات رسمية قادمة',
  },
  recurringHolidayNote: { en: 'Recurring', ar: 'متكرر سنوياً' },
  deptOtBreakdown: { en: 'Dept OT Breakdown', ar: 'عمل إضافي بالأقسام' },
  deptOtTitle: { en: 'Department OT Summary', ar: 'ملخص العمل الإضافي للأقسام' },
  weekdayOt: { en: 'Weekday', ar: 'أيام العمل' },
  weekendOt: { en: 'Weekend', ar: 'عطلة نهاية الأسبوع' },
  holidayOt: { en: 'Holiday', ar: 'إجازة رسمية' },
  totalOt: { en: 'Total', ar: 'الإجمالي' },
  periodTotals: { en: 'Period Totals', ar: 'إجماليات الفترة' },
  byDepartment: { en: 'By Department', ar: 'حسب القسم' },
  noDeptOtData: { en: 'No overtime recorded for this period', ar: 'لا يوجد عمل إضافي مسجل لهذه الفترة' },
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
