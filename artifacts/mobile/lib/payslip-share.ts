import { Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Payslip } from '@workspace/api-client-react';
import type { Lang, StringKey } from './i18n';
import { buildPayslipText } from './payslip-share-text';
import { buildPayslipHtml } from './payslip-pdf-html';

type Translate = (key: StringKey) => string;

/**
 * Web-only: renders the payslip HTML into a hidden same-origin iframe and
 * opens the browser print dialog on that document (so the user saves the
 * branded payslip — not the app page — as a PDF). Iframes are not affected
 * by popup blockers. Exported for testing.
 */
export async function printPayslipHtmlOnWeb(html: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();
    // Wait for the iframe document (fonts/styles) to settle before printing;
    // fall back to a short timeout in case load already fired.
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      iframe.addEventListener('load', finish, { once: true });
      setTimeout(finish, 250);
    });
    const win = iframe.contentWindow;
    if (!win) {
      iframe.remove();
      return false;
    }
    win.focus();
    win.print();
    // Keep the iframe alive while the print dialog reads from it.
    setTimeout(() => iframe.remove(), 60_000);
    return true;
  } catch {
    iframe.remove();
    return false;
  }
}

/**
 * Shares the payslip as a branded, bilingual PDF document.
 * - Native (iOS/Android): renders the PDF with expo-print and hands the file
 *   to the OS share sheet via expo-sharing. Falls back to sharing the
 *   formatted text if file sharing is unavailable on the device.
 * - Web: opens the browser print dialog on the rendered payslip so the user
 *   can save/download it as a PDF (the standard "Save as PDF" flow).
 * Returns true on success, false if sharing failed.
 */
export async function sharePayslip(
  data: Payslip,
  lang: Lang,
  t: Translate,
): Promise<boolean> {
  const html = buildPayslipHtml(data, lang, t);
  const title = `${t('payslipDetail')} · ${
    lang === 'ar' && data.period.nameAr ? data.period.nameAr : data.period.nameEn
  }`;

  try {
    if (Platform.OS === 'web') {
      // Render the branded payslip in a hidden iframe and open the browser
      // print dialog on it, where the user saves/downloads it as a PDF.
      return await printPayslipHtmlOnWeb(html);
    }

    const { uri: tempUri } = await Print.printToFileAsync({ html });

    // Move the random-named temp file to a recognisable name before handing
    // it to the share sheet (e.g. "payslip-2026-07-EMP-0007.pdf").
    const fileName = `payslip-${data.period.periodCode}-${data.employee.employeeNumber}.pdf`;
    const namedFile = new File(Paths.cache, fileName);
    new File(tempUri).move(namedFile);

    if (await Sharing.isAvailableAsync()) {
      try {
        await Sharing.shareAsync(namedFile.uri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: title,
        });
      } finally {
        // Clean up after the share sheet is dismissed.
        namedFile.delete();
      }
      return true;
    }

    // Named copy is no longer needed if file sharing is unavailable.
    namedFile.delete();

    // Fallback: device cannot share files — share the formatted text instead.
    const text = buildPayslipText(data, lang, t);
    await Share.share(
      Platform.OS === 'ios' ? { message: text } : { message: text, title },
      { dialogTitle: title, subject: title },
    );
    return true;
  } catch (err) {
    // User dismissing the print/share dialog is not a failure.
    if (err instanceof Error && err.name === 'AbortError') return true;
    if (
      err instanceof Error &&
      /cancell?ed|dismissed/i.test(err.message ?? '')
    ) {
      return true;
    }
    return false;
  }
}
