import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { supportsLinuxLock } from './linuxDesktop';
import { readLinuxClipboardSnapshot } from './linuxClipboardNative';

const exec = promisify(execFile);
/** Linux has no portable clipboard generation counter. Fingerprint only the
 * portable formats that our existing transfer path can expose, never file URLs.
 * This is called within the controlling lease, never as an application watcher. */
async function unlocked(): Promise<void> {
  if (!supportsLinuxLock()) throw new Error('DESKTOP_CLIPBOARD_UNAVAILABLE');
  try {
    const { stdout } = await exec(
      '/usr/bin/loginctl',
      ['show-session', process.env.XDG_SESSION_ID!, '-p', 'LockedHint', '--value'],
      { timeout: 1000, maxBuffer: 128 },
    );
    if (stdout.trim() !== 'no') throw new Error('DESKTOP_CLIPBOARD_UNAVAILABLE');
  } catch {
    throw new Error('DESKTOP_CLIPBOARD_UNAVAILABLE');
  }
}
export async function linuxClipboardVersion(): Promise<string> {
  await unlocked();
  const snapshot = await readLinuxClipboardSnapshot();
  await unlocked();
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
export async function linuxSelection(): Promise<string> {
  await unlocked();
  const text = (await readLinuxClipboardSnapshot(true)).content.text ?? '';
  await unlocked();
  if (text.length > 16384) throw new Error('DESKTOP_CLIPBOARD_COPY_FAILED');
  return text;
}
