import { Capacitor } from '@capacitor/core';
import { LocusUpdater } from './locusUpdater';
import { ACTIVITY_LOG } from '../copy/group';
import { copyText } from './clipboard';

// The activity log as a CSV file (components/group/ActivityLog.jsx's Export log), and handing it
// over: on a phone, Android's share sheet (LocusUpdaterPlugin.shareTextFile: save it to Files,
// send it in a chat or by mail); in a browser, its own share sheet or a download. A phone whose
// app predates shareTextFile copies the CSV to the clipboard instead.

const cell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const pad = (n) => String(n).padStart(2, '0');
/** "2026-10-23 21:05:09" in this phone's own time. */
export const localTime = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** The log, oldest first, as CSV text with a header row. */
export function activityLogCsv(entries) {
  const rows = [['Time', 'Event', 'Name', 'User ID', 'By', 'By user ID']];
  for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
    rows.push([
      localTime(entry.at),
      ACTIVITY_LOG.kinds[entry.kind] ?? entry.kind,
      entry.name ?? '',
      entry.uid ?? '',
      entry.byName ?? '',
      entry.byUid ?? '',
    ]);
  }
  return `${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** "locus-activity-ABC123-2026-10-23.csv" */
export const activityLogFileName = (code, now = Date.now()) =>
  `locus-activity-${String(code || 'group').replace(/[^A-Za-z0-9]/g, '')}-${localTime(now).slice(0, 10)}.csv`;

/**
 * Hands the log over. @returns {Promise<'shared' | 'downloaded' | 'copied' | 'failed'>}
 */
export async function exportActivityLog(entries, code) {
  const text = activityLogCsv(entries);
  const name = activityLogFileName(code);
  if (Capacitor.isNativePlatform()) {
    try {
      await LocusUpdater.shareTextFile({ name, text, mimeType: 'text/csv', title: ACTIVITY_LOG.export });
      return 'shared';
    } catch {
      return (await copyText(text)) ? 'copied' : 'failed';
    }
  }
  try {
    const file = typeof File === 'function' ? new File([text], name, { type: 'text/csv' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: ACTIVITY_LOG.title });
      return 'shared';
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return 'downloaded';
  } catch {
    return (await copyText(text)) ? 'copied' : 'failed';
  }
}
