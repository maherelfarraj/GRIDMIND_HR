import { Platform, Share } from 'react-native';
import type { Payslip } from '@workspace/api-client-react';
import type { Lang, StringKey } from '@/lib/i18n';
import { buildPayslipText } from '@/lib/payslip-share-text';

type Translate = (key: StringKey) => string;

function payslipFileName(data: Payslip): string {
  const code = data.period.periodCode || String(data.runId);
  return `payslip-${code}-${data.employee.employeeNumber}.txt`;
}

/**
 * Shares the payslip as bilingual formatted text.
 * - Native: uses the OS share sheet.
 * - Web: uses the Web Share API when available, otherwise downloads a .txt file.
 * Returns true on success, false if sharing failed.
 */
export async function sharePayslip(
  data: Payslip,
  lang: Lang,
  t: Translate,
): Promise<boolean> {
  const text = buildPayslipText(data, lang, t);
  const title = `${t('payslipDetail')} · ${
    lang === 'ar' && data.period.nameAr ? data.period.nameAr : data.period.nameEn
  }`;

  try {
    if (Platform.OS === 'web') {
      const nav =
        typeof navigator !== 'undefined'
          ? (navigator as Navigator & {
              share?: (d: { title?: string; text?: string }) => Promise<void>;
            })
          : undefined;
      if (nav?.share) {
        await nav.share({ title, text });
        return true;
      }
      // Fallback: download as a text file.
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = payslipFileName(data);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    }
    await Share.share(
      Platform.OS === 'ios' ? { message: text } : { message: text, title },
      { dialogTitle: title, subject: title },
    );
    return true;
  } catch (err) {
    // User cancelling the web share sheet is not a failure.
    if (err instanceof Error && err.name === 'AbortError') return true;
    return false;
  }
}
