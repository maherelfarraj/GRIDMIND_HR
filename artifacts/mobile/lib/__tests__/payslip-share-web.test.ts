/**
 * Web-branch coverage for the payslip PDF share.
 *
 * On web, sharePayslip must render the generated branded payslip HTML into a
 * hidden same-origin iframe and invoke print() on THAT document — not on the
 * app page (expo-print's web adapter ignores the html argument and would
 * print the mobile UI). These tests assert the payslip content is actually
 * written into the printable iframe document before printing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Payslip } from '@workspace/api-client-react';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Share: { share: vi.fn() },
}));
vi.mock('expo-print', () => ({
  printAsync: vi.fn(),
  printToFileAsync: vi.fn(),
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => false),
  shareAsync: vi.fn(),
}));

import { sharePayslip } from '../payslip-share';

const strings: Record<string, { en: string; ar: string }> = {
  payslipDetail: { en: 'Payslip', ar: 'قسيمة الراتب' },
  payDate: { en: 'Pay Date', ar: 'تاريخ الصرف' },
  employee: { en: 'Employee', ar: 'الموظف' },
  jobTitle: { en: 'Job Title', ar: 'المسمى الوظيفي' },
  department: { en: 'Department', ar: 'القسم' },
  earnings: { en: 'Earnings', ar: 'الاستحقاقات' },
  baseSalary: { en: 'Base Salary', ar: 'الراتب الأساسي' },
  overtime: { en: 'Overtime', ar: 'العمل الإضافي' },
  hours: { en: 'hours', ar: 'ساعة' },
  gross: { en: 'Gross', ar: 'إجمالي' },
  deductions: { en: 'Deductions', ar: 'الاستقطاعات' },
  noLines: { en: 'No line items', ar: 'لا توجد بنود' },
  workingDays: { en: 'Working Days', ar: 'أيام العمل' },
  presentDays: { en: 'Present Days', ar: 'أيام الحضور' },
  netPay: { en: 'Net Pay', ar: 'صافي الراتب' },
};

const tEn = (key: string) => strings[key]?.en ?? key;
const tAr = (key: string) => strings[key]?.ar ?? key;

const payslip: Payslip = {
  runId: 42,
  employee: {
    id: 7,
    employeeNumber: 'EMP-0007',
    fullNameEn: 'Sara Ahmed',
    fullNameAr: 'سارة أحمد',
    jobTitleEn: 'Analyst',
    jobTitleAr: 'محللة',
    nationalId: '1234567890',
    grade: 'G5',
    departmentNameEn: 'Finance',
    departmentNameAr: 'المالية',
  },
  period: {
    periodCode: '2026-07',
    nameEn: 'July 2026',
    nameAr: 'يوليو 2026',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    payDate: '2026-08-01',
  },
  summary: {
    baseSalary: '10000',
    grossSalary: '11500',
    totalEarnings: '1500',
    totalDeductions: '500',
    netSalary: '11000',
    overtimeHours: '10',
    overtimePay: '300',
    workingDays: 22,
    presentDays: 21,
    currency: 'SAR',
  },
  earnings: [
    {
      id: 1,
      nameEn: 'Housing Allowance',
      nameAr: 'بدل سكن',
      amount: '1200',
    } as Payslip['earnings'][number],
  ],
  deductions: [
    {
      id: 2,
      nameEn: 'GOSI',
      nameAr: 'التأمينات',
      amount: '500',
    } as Payslip['deductions'][number],
  ],
  hasException: false,
};

afterEach(() => {
  for (const el of Array.from(document.querySelectorAll('iframe'))) el.remove();
  vi.clearAllMocks();
});

describe('sharePayslip on web', () => {
  it('writes the branded payslip HTML into a hidden iframe and prints it', async () => {
    const pending = sharePayslip(payslip, 'en', tEn as never);

    // The iframe is created and populated synchronously before the load wait.
    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const doc = iframe!.contentDocument!;
    const html = doc.documentElement.outerHTML;
    expect(doc.documentElement.getAttribute('dir')).toBe('ltr');
    expect(html).toContain('Sara Ahmed (EMP-0007)');
    expect(html).toContain('Housing Allowance');
    expect(html).toContain('GOSI');
    expect(html).toContain('11,000.00');
    expect(html).toContain('Net Pay');

    // Print must be invoked on the iframe's window, not the app window.
    const framePrint = vi.fn();
    (iframe!.contentWindow as Window & { print: () => void }).print =
      framePrint;
    const appPrint = vi.fn();
    window.print = appPrint;

    await expect(pending).resolves.toBe(true);
    expect(framePrint).toHaveBeenCalledTimes(1);
    expect(appPrint).not.toHaveBeenCalled();
  });

  it('renders the Arabic payslip RTL in the printable document', async () => {
    const pending = sharePayslip(payslip, 'ar', tAr as never);

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const doc = iframe!.contentDocument!;
    expect(doc.documentElement.getAttribute('dir')).toBe('rtl');
    expect(doc.documentElement.outerHTML).toContain('سارة أحمد');
    expect(doc.documentElement.outerHTML).toContain('صافي الراتب');

    (iframe!.contentWindow as Window & { print: () => void }).print = vi.fn();
    await expect(pending).resolves.toBe(true);
  });
});
