/**
 * Builds a self-contained, print-ready HTML document for a payslip.
 * Mirrors the layout produced by artifacts/mobile/lib/payslip-pdf-html.ts so
 * web and mobile users receive the same branded, bilingual (RTL-aware) document.
 *
 * The web version accepts the HRMS inline bilingual t() signature
 * (t(enText, arText) → string) rather than the mobile key-based translator.
 */

import type { Payslip, PayrollRunLine } from '@workspace/api-client-react';

type Lang = 'en' | 'ar';

function formatAmount(value: string | number | null | undefined): string {
  return Number(value ?? 0).toLocaleString(undefined, {
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

function lineRows(lines: PayrollRunLine[], lang: Lang, negative: boolean): string {
  return lines
    .map(
      (line) =>
        `<tr>
          <td>${escapeHtml(lineName(line, lang))}</td>
          <td class="num${negative ? ' neg' : ''}">${negative ? '&#8722;' : ''}${formatAmount(line.amount)}</td>
        </tr>`,
    )
    .join('\n');
}

function infoCell(label: string, value: string): string {
  return `<div class="info-cell">
    <div class="info-label">${escapeHtml(label)}</div>
    <div class="info-value">${escapeHtml(value)}</div>
  </div>`;
}

/**
 * Returns a complete HTML document string ready to inject into an iframe and
 * trigger window.print() for a PDF download.
 *
 * @param data    Payslip data from the API
 * @param lang    Current UI language ('en' | 'ar')
 * @param t       HRMS inline bilingual translator — t(enText, arText)
 */
export function buildWebPayslipHtml(
  data: Payslip,
  lang: Lang,
  t: (en: string, ar: string) => string,
): string {
  const ar = lang === 'ar';
  const emp = data.employee;
  const periodName = ar && data.period.nameAr ? data.period.nameAr : data.period.nameEn;
  const empName = ar ? emp.fullNameAr || emp.fullNameEn : emp.fullNameEn;
  const jobTitle = ar ? emp.jobTitleAr || emp.jobTitleEn : emp.jobTitleEn;
  const department = ar
    ? emp.departmentNameAr || emp.departmentNameEn
    : emp.departmentNameEn;

  const currency = data.summary.currency || 'SAR';

  const overtimeRow =
    Number(data.summary.overtimePay) > 0
      ? `<tr>
          <td>${escapeHtml(t('Overtime', 'الوقت الإضافي'))} (${Number(data.summary.overtimeHours).toLocaleString()} ${escapeHtml(t('hrs', 'ساعة'))})</td>
          <td class="num">${formatAmount(data.summary.overtimePay)}</td>
        </tr>`
      : '';

  const deductionRows =
    data.deductions.length === 0
      ? `<tr><td colspan="2" class="muted">${escapeHtml(t('No deductions', 'لا توجد استقطاعات'))}</td></tr>`
      : lineRows(data.deductions, lang, true);

  const earningsRows =
    data.earnings.length === 0
      ? ''
      : lineRows(data.earnings, lang, false);

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(t('Payslip', 'قسيمة الراتب'))} · ${escapeHtml(periodName)}</title>
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
      <div class="brand">GridMindHR</div>
      <div class="brand-sub">${ar ? 'منصة إدارة الموارد البشرية' : 'People. Insights. Impact.'}</div>
    </div>
    <div class="doc-title">
      <div class="title">${ar ? 'قسيمة الراتب' : 'PAYSLIP'}</div>
      <div class="period">${escapeHtml(periodName)} · ${escapeHtml(data.period.startDate)} → ${escapeHtml(data.period.endDate)}</div>
      <div class="period">${escapeHtml(t('Pay Date', 'تاريخ الصرف'))}: ${escapeHtml(data.period.payDate)}</div>
    </div>
  </div>

  <div class="info-grid">
    ${infoCell(t('Employee', 'الموظف'), `${empName} (${emp.employeeNumber})`)}
    ${jobTitle ? infoCell(t('Job Title', 'المسمى الوظيفي'), jobTitle) : ''}
    ${department ? infoCell(t('Department', 'الإدارة'), department) : ''}
    ${emp.nationalId ? infoCell(t('National ID', 'الهوية الوطنية'), emp.nationalId) : ''}
    ${infoCell(t('Currency', 'العملة'), currency)}
    ${infoCell(t('Period Code', 'رمز الفترة'), data.period.periodCode)}
  </div>

  <h2>${escapeHtml(t('Earnings', 'المستحقات'))}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t('Earnings', 'المستحقات'))}</th>
        <th class="num">${escapeHtml(currency)}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(t('Base Salary', 'الراتب الأساسي'))}</td>
        <td class="num">${formatAmount(data.summary.baseSalary)}</td>
      </tr>
      ${earningsRows}
      ${overtimeRow}
      <tr class="total">
        <td>${escapeHtml(t('Gross Salary', 'إجمالي الراتب'))}</td>
        <td class="num">${formatAmount(data.summary.grossSalary)}</td>
      </tr>
    </tbody>
  </table>

  <h2>${escapeHtml(t('Deductions', 'الاستقطاعات'))}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(t('Deductions', 'الاستقطاعات'))}</th>
        <th class="num">${escapeHtml(currency)}</th>
      </tr>
    </thead>
    <tbody>
      ${deductionRows}
      <tr class="total">
        <td>${escapeHtml(t('Total Deductions', 'إجمالي الاستقطاعات'))}</td>
        <td class="num neg">&#8722;${formatAmount(data.summary.totalDeductions)}</td>
      </tr>
    </tbody>
  </table>

  <div class="net">
    <div class="label">${escapeHtml(t('Net Salary', 'صافي الراتب'))}</div>
    <div class="value">${formatAmount(data.summary.netSalary)} ${escapeHtml(currency)}</div>
  </div>

  <div class="meta">
    <div>${escapeHtml(t('Working Days', 'أيام العمل'))}: ${data.summary.workingDays}</div>
    <div>${escapeHtml(t('Present Days', 'أيام الحضور'))}: ${data.summary.presentDays}</div>
  </div>

  <div class="footer">
    ${
      ar
        ? 'وثيقة صادرة إلكترونيًا من GridMindHR — صالحة بدون توقيع.'
        : 'Electronically generated by GridMindHR — valid without signature.'
    }
  </div>
</body>
</html>`;
}

/**
 * Opens the payslip HTML in a hidden iframe and invokes print() so the browser
 * shows a "Save as PDF" / print dialog with the branded document.
 *
 * @param html      Output of buildWebPayslipHtml()
 * @param filename  Suggested filename shown in the print dialog title bar
 */
export function printPayslipHtml(html: string, filename: string): void {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Give the iframe's document a title so OS print dialogs suggest a filename
  doc.title = filename;

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // Remove after a short delay so the print dialog can read the content
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }
  };
}
