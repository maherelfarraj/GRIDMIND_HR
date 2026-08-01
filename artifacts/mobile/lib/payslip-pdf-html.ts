import type { Payslip, PayrollRunLine } from '@workspace/api-client-react';
import type { Lang, StringKey } from '@/lib/i18n';

type Translate = (key: StringKey) => string;

function formatAmount(value: string | number): string {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lineName(line: PayrollRunLine, lang: Lang): string {
  return lang === 'ar' && line.nameAr ? line.nameAr : line.nameEn;
}

function lineRows(
  lines: PayrollRunLine[],
  lang: Lang,
  negative: boolean,
): string {
  return lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(lineName(line, lang))}</td>
        <td class="num${negative ? ' neg' : ''}">${
          negative ? '&#8722;' : ''
        }${formatAmount(line.amount)}</td>
      </tr>`,
    )
    .join('\n');
}

/**
 * Builds a self-contained, print-ready HTML document for the payslip.
 * Layout is bilingual per current language and RTL for Arabic; rendered to
 * PDF via expo-print on native or the browser print pipeline on web.
 */
export function buildPayslipHtml(
  data: Payslip,
  lang: Lang,
  t: Translate,
): string {
  const ar = lang === 'ar';
  const emp = data.employee;
  const periodName =
    ar && data.period.nameAr ? data.period.nameAr : data.period.nameEn;
  const empName = ar ? emp.fullNameAr || emp.fullNameEn : emp.fullNameEn;
  const jobTitle = ar ? emp.jobTitleAr || emp.jobTitleEn : emp.jobTitleEn;
  const department = ar
    ? emp.departmentNameAr || emp.departmentNameEn
    : emp.departmentNameEn;

  const infoCell = (label: string, value: string) => `<div class="info-cell">
      <div class="info-label">${escapeHtml(label)}</div>
      <div class="info-value">${escapeHtml(value)}</div>
    </div>`;

  const overtimeRow =
    Number(data.summary.overtimePay) > 0
      ? `<tr>
          <td>${escapeHtml(t('overtime'))} (${Number(
            data.summary.overtimeHours,
          ).toLocaleString()} ${escapeHtml(t('hours'))})</td>
          <td class="num">${formatAmount(data.summary.overtimePay)}</td>
        </tr>`
      : '';

  const deductionRows =
    data.deductions.length === 0
      ? `<tr><td colspan="2" class="muted">${escapeHtml(t('noLines'))}</td></tr>`
      : lineRows(data.deductions, lang, true);

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(t('payslipDetail'))} · ${escapeHtml(periodName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${
      ar
        ? "'Segoe UI', Tahoma, 'Noto Sans Arabic', sans-serif"
        : "'Segoe UI', Helvetica, Arial, sans-serif"
    };
    color: #0f172a;
    font-size: 12px;
    padding: 32px;
    direction: ${ar ? 'rtl' : 'ltr'};
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #1d4ed8;
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .brand { font-size: 20px; font-weight: 700; color: #1d4ed8; letter-spacing: 0.5px; }
  .brand-sub { font-size: 10px; color: #64748b; margin-top: 2px; }
  .doc-title { text-align: ${ar ? 'left' : 'right'}; }
  .doc-title .title { font-size: 16px; font-weight: 700; }
  .doc-title .period { font-size: 11px; color: #475569; margin-top: 2px; }
  .info-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 18px;
  }
  .info-cell { min-width: 140px; }
  .info-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #64748b; }
  .info-value { font-size: 12px; font-weight: 600; margin-top: 2px; }
  h2 { font-size: 12px; color: #1d4ed8; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; text-align: ${ar ? 'right' : 'left'}; }
  th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; }
  td.num, th.num { text-align: ${ar ? 'left' : 'right'}; font-variant-numeric: tabular-nums; }
  td.neg { color: #b91c1c; }
  td.muted { color: #94a3b8; }
  tr.total td { font-weight: 700; border-top: 2px solid #cbd5e1; border-bottom: none; }
  .net {
    margin-top: 22px;
    background: #1d4ed8;
    color: #ffffff;
    border-radius: 8px;
    padding: 14px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .net .label { font-size: 12px; font-weight: 600; }
  .net .value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .meta { margin-top: 14px; display: flex; gap: 24px; color: #475569; font-size: 11px; }
  .footer { margin-top: 28px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 9px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">HRMS</div>
      <div class="brand-sub">${
        ar ? 'نظام إدارة الموارد البشرية' : 'Enterprise HR Management'
      }</div>
    </div>
    <div class="doc-title">
      <div class="title">${escapeHtml(t('payslipDetail'))}</div>
      <div class="period">${escapeHtml(periodName)} · ${escapeHtml(
        data.period.startDate,
      )} → ${escapeHtml(data.period.endDate)}</div>
      <div class="period">${escapeHtml(t('payDate'))}: ${escapeHtml(
        data.period.payDate,
      )}</div>
    </div>
  </div>

  <div class="info-grid">
    ${infoCell(t('employee'), `${empName} (${emp.employeeNumber})`)}
    ${jobTitle ? infoCell(t('jobTitle'), jobTitle) : ''}
    ${department ? infoCell(t('department'), department) : ''}
  </div>

  <h2>${escapeHtml(t('earnings'))}</h2>
  <table>
    <thead><tr><th>${escapeHtml(t('earnings'))}</th><th class="num">${escapeHtml(
      data.summary.currency,
    )}</th></tr></thead>
    <tbody>
      <tr>
        <td>${escapeHtml(t('baseSalary'))}</td>
        <td class="num">${formatAmount(data.summary.baseSalary)}</td>
      </tr>
      ${lineRows(data.earnings, lang, false)}
      ${overtimeRow}
      <tr class="total">
        <td>${escapeHtml(t('gross'))}</td>
        <td class="num">${formatAmount(data.summary.grossSalary)}</td>
      </tr>
    </tbody>
  </table>

  <h2>${escapeHtml(t('deductions'))}</h2>
  <table>
    <thead><tr><th>${escapeHtml(t('deductions'))}</th><th class="num">${escapeHtml(
      data.summary.currency,
    )}</th></tr></thead>
    <tbody>
      ${deductionRows}
      <tr class="total">
        <td>${escapeHtml(t('deductions'))}</td>
        <td class="num neg">&#8722;${formatAmount(
          data.summary.totalDeductions,
        )}</td>
      </tr>
    </tbody>
  </table>

  <div class="net">
    <div class="label">${escapeHtml(t('netPay'))}</div>
    <div class="value">${formatAmount(data.summary.netSalary)} ${escapeHtml(
      data.summary.currency,
    )}</div>
  </div>

  <div class="meta">
    <div>${escapeHtml(t('workingDays'))}: ${data.summary.workingDays}</div>
    <div>${escapeHtml(t('presentDays'))}: ${data.summary.presentDays}</div>
  </div>

  <div class="footer">
    ${
      ar
        ? 'وثيقة صادرة إلكترونيًا من نظام إدارة الموارد البشرية — صالحة بدون توقيع.'
        : 'Electronically generated by the HRMS system — valid without signature.'
    }
  </div>
</body>
</html>`;
}
