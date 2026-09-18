import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('electron', () => ({ app: {} }));
vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }));
vi.mock('node:util', () => ({ promisify: () => h.exec }));
vi.mock('node:fs', () => ({ accessSync: vi.fn(), constants: { X_OK: 1 } }));
import { readLinuxClipboardSnapshot } from '../linuxClipboardNative';
beforeEach(() => {
  h.exec.mockReset();
  vi.stubGlobal('process', { ...process, platform: 'linux' });
  vi.stubEnv('HYPRLAND_INSTANCE_SIGNATURE', 'test');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it('reads all offered portable text alternatives while Cindy is unfocused', async () => {
  h.exec.mockImplementation(async (_tool, args: string[]) => ({
    stdout: Buffer.from(
      args.includes('--list-types')
        ? 'text/plain;charset=utf-8\ntext/html\ntext/rtf\n'
        : args.at(-1) === 'text/html'
          ? '<b>Hello</b>'
          : args.at(-1) === 'text/rtf'
            ? '{\\rtf1 Hello}'
            : 'Hello',
    ),
  }));
  expect((await readLinuxClipboardSnapshot()).content).toEqual({
    text: 'Hello',
    html: '<b>Hello</b>',
    rtf: '{\\rtf1 Hello}',
  });
});
it('does not read file-manager paths disguised as text or HTML', async () => {
  h.exec.mockResolvedValue({ stdout: Buffer.from('text/uri-list\ntext/plain\ntext/html\n') });
  expect((await readLinuxClipboardSnapshot()).content).toEqual({});
  expect(h.exec).toHaveBeenCalledOnce();
});
it('does not leak native clipboard diagnostics or confuse refusal with empty selection', async () => {
  h.exec.mockRejectedValue({
    stderr: Buffer.from('secret clipboard diagnostics'),
    stdout: Buffer.from('private text'),
  });
  await expect(readLinuxClipboardSnapshot()).rejects.toThrow('DESKTOP_CLIPBOARD_UNAVAILABLE');
  h.exec.mockRejectedValue({ stderr: Buffer.from('Nothing is copied') });
  expect((await readLinuxClipboardSnapshot()).content).toEqual({});
});
