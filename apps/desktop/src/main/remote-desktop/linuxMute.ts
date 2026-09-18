import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export function supportsLinuxMute(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    for (const tool of ['pactl', 'pw-dump', 'pw-cli'])
      accessSync(`/usr/bin/${tool}`, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
interface Sink {
  id: number;
  serial: number;
  name: string;
  muted: boolean;
}
/** Mute playback only, leaving the monitor branch audible remotely. Object
 * serial protects against numeric ID reuse after unplug. Writes are serialized. */
export class LinuxDesktopMute {
  private original: Sink | null = null;
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly run = async (tool: string, args: string[]) => {
      const { stdout } = await exec(`/usr/bin/${tool}`, args, {
        timeout: 2000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return stdout;
    },
  ) {}
  private async sinks(): Promise<Sink[]> {
    const nodes: unknown = JSON.parse(await this.run('pw-dump', []));
    if (!Array.isArray(nodes) || nodes.length > 10000)
      throw new Error('DESKTOP_HOST_MUTE_UNAVAILABLE');
    return nodes.flatMap((node) => {
      const props = node?.info?.props;
      const params = node?.info?.params?.Props;
      const mute = Array.isArray(params)
        ? params.find((p) => typeof p?.softMute === 'boolean')
        : undefined;
      const serial = Number(props?.['object.serial']);
      return Number.isSafeInteger(node?.id) &&
        node.id > 0 &&
        Number.isSafeInteger(serial) &&
        serial > 0 &&
        props?.['media.class'] === 'Audio/Sink' &&
        typeof props['node.name'] === 'string' &&
        mute
        ? [{ id: node.id, serial, name: props['node.name'], muted: mute.softMute }]
        : [];
    });
  }
  set(enabled: boolean): Promise<void> {
    const result = this.tail
      .then(async () => {
        if (!enabled && !this.original) return;
        const sinks = await this.sinks();
        if (!this.original) {
          const name = (await this.run('pactl', ['get-default-sink'])).trim();
          const sink = sinks.find((s) => s.name === name);
          if (!sink) throw new Error('DESKTOP_HOST_MUTE_UNAVAILABLE');
          this.original = sink;
        }
        const original = this.original;
        if (!sinks.some((s) => s.id === original.id && s.serial === original.serial)) {
          this.original = null;
          if (enabled) throw new Error('DESKTOP_HOST_MUTE_UNAVAILABLE');
          return;
        }
        await this.run('pw-cli', [
          'set-param',
          String(original.id),
          'Props',
          `{ softMute: ${enabled || original.muted ? 'true' : 'false'} }`,
        ]);
        if (!enabled) this.original = null;
      })
      .catch(() => {
        throw new Error('DESKTOP_HOST_MUTE_UNAVAILABLE');
      });
    this.tail = result.catch(() => {});
    return result;
  }
}
