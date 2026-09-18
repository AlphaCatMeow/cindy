import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ locked: false, text: 'text', supported: true, read: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:util', () => ({
  promisify: () => async () => ({ stdout: h.locked ? 'yes' : 'no' }),
}));
vi.mock('../linuxDesktop', () => ({ supportsLinuxLock: () => h.supported }));
vi.mock('../linuxClipboardNative', () => ({
  readLinuxClipboardSnapshot: async () => {
    h.read();
    if (h.text.length > 512000) throw new Error('CLIPBOARD_TOO_LONG');
    return { formats: ['text/plain'], content: { text: h.text } };
  },
}));
import { linuxClipboardVersion } from '../linuxClipboard';
beforeEach(() => {
  h.locked = false;
  h.supported = true;
  h.text = 'text';
  h.read.mockClear();
});
it('changes the opaque generation when clipboard contents change', async () => {
  const before = await linuxClipboardVersion();
  expect(await linuxClipboardVersion()).toBe(before);
  expect(before).toMatch(/^[a-f0-9]{64}$/);
  h.text = 'different';
  expect(await linuxClipboardVersion()).not.toBe(before);
});
it('does not read clipboard content while the session is locked', async () => {
  h.locked = true;
  await expect(linuxClipboardVersion()).rejects.toThrow('DESKTOP_CLIPBOARD_UNAVAILABLE');
  expect(h.read).not.toHaveBeenCalled();
});
it('bounds content and returns no sampled text in an error', async () => {
  h.text = 'private'.repeat(100000);
  await expect(linuxClipboardVersion()).rejects.toThrow('CLIPBOARD_TOO_LONG');
});
