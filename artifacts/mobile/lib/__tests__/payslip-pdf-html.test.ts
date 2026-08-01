import { describe, expect, it } from 'vitest';
import type { Payslip } from '@workspace/api-client-react';
import { buildPayslipHtml } from '../payslip-pdf-html';

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

describe('buildPayslipHtml', () => {
  it('renders an LTR English document with all sections', () => {
    const html = buildPayslipHtml(payslip, 'en', tEn as never);
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('Payslip');
    expect(html).toContain('July 2026');
    expect(html).toContain('2026-07-01 → 2026-07-31');
    expect(html).toContain('Pay Date');
    expect(html).toContain('Sara Ahmed (EMP-0007)');
    expect(html).toContain('Analyst');
    expect(html).toContain('Finance');
    expect(html).toContain('Base Salary');
    expect(html).toContain('Housing Allowance');
    expect(html).toContain('1,200.00');
    expect(html).toContain('Overtime');
    expect(html).toContain('11,500.00');
    expect(html).toContain('GOSI');
    expect(html).toContain('11,000.00');
    expect(html).toContain('SAR');
    expect(html).toContain('Working Days');
  });

  it('renders an RTL Arabic document with Arabic names and labels', () => {
    const html = buildPayslipHtml(payslip, 'ar', tAr as never);
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('direction: rtl');
    expect(html).toContain('سارة أحمد (EMP-0007)');
    expect(html).toContain('بدل سكن');
    expect(html).toContain('التأمينات');
    expect(html).toContain('صافي الراتب');
    expect(html).not.toContain('Sara Ahmed');
  });

  it('omits the overtime row when overtime pay is zero', () => {
    const html = buildPayslipHtml(
      {
        ...payslip,
        summary: { ...payslip.summary, overtimePay: '0' },
      },
      'en',
      tEn as never,
    );
    expect(html).not.toContain('Overtime');
  });

  it('shows the no-lines marker when there are no deductions', () => {
    const html = buildPayslipHtml(
      { ...payslip, deductions: [] },
      'en',
      tEn as never,
    );
    expect(html).toContain('No line items');
  });

  it('escapes HTML in dynamic values', () => {
    const html = buildPayslipHtml(
      {
        ...payslip,
        employee: {
          ...payslip.employee,
          fullNameEn: 'Sara <script>alert(1)</script>',
        },
      },
      'en',
      tEn as never,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
