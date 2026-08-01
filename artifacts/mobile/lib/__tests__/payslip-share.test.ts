import { describe, expect, it } from 'vitest';
import type { Payslip } from '@workspace/api-client-react';
import { buildPayslipText } from '../payslip-share-text';

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

describe('buildPayslipText', () => {
  it('includes employee, period, lines, and net pay in English', () => {
    const text = buildPayslipText(payslip, 'en', tEn as never);
    expect(text).toContain('Payslip · July 2026');
    expect(text).toContain('2026-07-01 → 2026-07-31');
    expect(text).toContain('Pay Date: 2026-08-01');
    expect(text).toContain('Employee: Sara Ahmed (EMP-0007)');
    expect(text).toContain('Job Title: Analyst');
    expect(text).toContain('Department: Finance');
    expect(text).toContain('Base Salary: 10,000.00');
    expect(text).toContain('Housing Allowance: 1,200.00');
    expect(text).toContain('Overtime (10 hours): 300.00');
    expect(text).toContain('Gross: 11,500.00');
    expect(text).toContain('GOSI: -500.00');
    expect(text).toContain('Net Pay: 11,000.00 SAR');
  });

  it('uses Arabic names and labels when language is ar', () => {
    const text = buildPayslipText(payslip, 'ar', tAr as never);
    expect(text).toContain('قسيمة الراتب · يوليو 2026');
    expect(text).toContain('الموظف: سارة أحمد (EMP-0007)');
    expect(text).toContain('بدل سكن');
    expect(text).toContain('التأمينات');
    expect(text).toContain('صافي الراتب: 11,000.00 SAR');
    expect(text).not.toContain('Sara Ahmed');
  });

  it('shows a no-lines marker when there are no deductions', () => {
    const text = buildPayslipText(
      { ...payslip, deductions: [] },
      'en',
      tEn as never,
    );
    expect(text).toContain('No line items');
  });
});
