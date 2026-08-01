import type { Payslip, PayrollRunLine } from '@workspace/api-client-react';
import type { Lang, StringKey } from '@/lib/i18n';

function formatAmount(value: string | number): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type Translate = (key: StringKey) => string;

function lineName(line: PayrollRunLine, lang: Lang): string {
  return lang === 'ar' && line.nameAr ? line.nameAr : line.nameEn;
}

export function buildPayslipText(
  data: Payslip,
  lang: Lang,
  t: Translate,
): string {
  const ar = lang === 'ar';
  const emp = data.employee;
  const periodName = ar && data.period.nameAr ? data.period.nameAr : data.period.nameEn;
  const empName = ar ? emp.fullNameAr || emp.fullNameEn : emp.fullNameEn;
  const jobTitle = ar ? emp.jobTitleAr || emp.jobTitleEn : emp.jobTitleEn;
  const department = ar
    ? emp.departmentNameAr || emp.departmentNameEn
    : emp.departmentNameEn;

  const lines: string[] = [];
  lines.push(`${t('payslipDetail')} · ${periodName}`);
  lines.push(`${data.period.startDate} → ${data.period.endDate}`);
  lines.push(`${t('payDate')}: ${data.period.payDate}`);
  lines.push('');
  lines.push(`${t('employee')}: ${empName} (${emp.employeeNumber})`);
  if (jobTitle) lines.push(`${t('jobTitle')}: ${jobTitle}`);
  if (department) lines.push(`${t('department')}: ${department}`);
  lines.push('');
  lines.push(`${t('earnings')}:`);
  lines.push(`- ${t('baseSalary')}: ${formatAmount(data.summary.baseSalary)}`);
  for (const line of data.earnings) {
    lines.push(`- ${lineName(line, lang)}: ${formatAmount(line.amount)}`);
  }
  if (Number(data.summary.overtimePay) > 0) {
    lines.push(
      `- ${t('overtime')} (${Number(
        data.summary.overtimeHours,
      ).toLocaleString()} ${t('hours')}): ${formatAmount(
        data.summary.overtimePay,
      )}`,
    );
  }
  lines.push(`${t('gross')}: ${formatAmount(data.summary.grossSalary)}`);
  lines.push('');
  lines.push(`${t('deductions')}:`);
  if (data.deductions.length === 0) {
    lines.push(`- ${t('noLines')}`);
  } else {
    for (const line of data.deductions) {
      lines.push(`- ${lineName(line, lang)}: -${formatAmount(line.amount)}`);
    }
  }
  lines.push(
    `${t('deductions')}: -${formatAmount(data.summary.totalDeductions)}`,
  );
  lines.push('');
  lines.push(`${t('workingDays')}: ${data.summary.workingDays}`);
  lines.push(`${t('presentDays')}: ${data.summary.presentDays}`);
  lines.push(
    `${t('netPay')}: ${formatAmount(data.summary.netSalary)} ${
      data.summary.currency
    }`,
  );
  return lines.join('\n');
}

