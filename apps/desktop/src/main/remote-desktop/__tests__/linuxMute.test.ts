import { expect, it, vi } from 'vitest';
import { LinuxDesktopMute } from '../linuxMute';
function setup(muted = false) {
  const sink = {
    id: 62,
    info: {
      props: { 'object.serial': 123, 'node.name': 'speakers', 'media.class': 'Audio/Sink' },
      params: { Props: [{ softMute: muted }] },
    },
  };
  let name = 'speakers';
  const run = vi.fn(async (tool: string) => {
    if (tool === 'pactl') return name;
    if (tool === 'pw-dump') return JSON.stringify([sink]);
    return '';
  });
  return {
    sink,
    run,
    mute: new LinuxDesktopMute(run),
    setDefault: (value: string) => {
      name = value;
    },
  };
}
it('restores the original output after default changes and stop races mute', async () => {
  const h = setup();
  await h.mute.set(true);
  h.setDefault('headphones');
  await Promise.all([h.mute.set(true), h.mute.set(false)]);
  expect(h.run).toHaveBeenLastCalledWith('pw-cli', [
    'set-param',
    '62',
    'Props',
    '{ softMute: false }',
  ]);
});
it('preserves pre-existing mute and retries failed restoration', async () => {
  const h = setup(true);
  await h.mute.set(true);
  h.run.mockRejectedValueOnce(new Error('private diagnostics'));
  await expect(h.mute.set(false)).rejects.toThrow('DESKTOP_HOST_MUTE_UNAVAILABLE');
  await h.mute.set(false);
  expect(h.run).toHaveBeenLastCalledWith('pw-cli', [
    'set-param',
    '62',
    'Props',
    '{ softMute: true }',
  ]);
});
it('does not touch a different output which reused an unplugged output ID', async () => {
  const h = setup();
  await h.mute.set(true);
  h.run.mockClear();
  h.sink.info.props['object.serial'] = 456;
  await h.mute.set(false);
  expect(h.run.mock.calls.some((c) => c[0] === 'pw-cli')).toBe(false);
});
