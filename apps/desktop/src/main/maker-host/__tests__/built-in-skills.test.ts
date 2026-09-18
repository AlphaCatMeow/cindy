import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  builtInSkillDescriptors,
  markCindyBuiltInAgentSkills,
  prepareBuiltInSkills,
  resolveBundledSystemSkillsRoot,
} from '../built-in-skills';

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-built-in-skills-'));
  roots.push(root);
  const bundledRoot = path.join(root, 'resources', 'system-skills');
  const source = path.join(bundledRoot, 'cindy-skill-creator');
  const learnSource = path.join(bundledRoot, 'learn');
  const userDataDir = path.join(root, 'user-data');
  const appDataDir = path.join(root, 'app-data');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.mkdirSync(learnSource, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: cindy-skill-creator\ndescription: Create Skills\n---\n\n# Creator\n',
  );
  fs.writeFileSync(path.join(source, 'scripts', 'validate.py'), 'print("ok")\n');
  fs.writeFileSync(
    path.join(learnSource, 'SKILL.md'),
    '---\nname: learn\ndescription: Start Cindy Learn\n---\n\n# Learn\n',
  );
  const withSharedMutation = async <T>(
    _names: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> => operation();
  return { bundledRoot, source, userDataDir, appDataDir, homeDir, withSharedMutation };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('built-in Skills', () => {
  it('materializes versioned bytes at a stable path and exposes them through the shared root', async () => {
    const input = fixture();
    const first = await prepareBuiltInSkills(input);
    const descriptor = builtInSkillDescriptors(input.userDataDir, input.appDataDir)[0]!;
    const link = path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator');
    expect(first.changed).toBe(true);
    expect(first.warnings).toEqual([]);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(descriptor.absolutePath));
    expect(fs.realpathSync(descriptor.nativeClaudePath)).toBe(
      fs.realpathSync(descriptor.absolutePath),
    );
    expect(fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8')).toContain(
      '# Creator',
    );
    const learnDescriptor = first.descriptors.find((item) => item.name === 'learn')!;
    expect(fs.realpathSync(path.join(input.homeDir, '.agents', 'skills', 'learn'))).toBe(
      fs.realpathSync(learnDescriptor.absolutePath),
    );
    expect(fs.readFileSync(path.join(learnDescriptor.absolutePath, 'SKILL.md'), 'utf8')).toContain(
      '# Learn',
    );

    const second = await prepareBuiltInSkills(input);
    expect(second.changed).toBe(false);

    fs.writeFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), '# Tampered\n');
    const repaired = await prepareBuiltInSkills(input);
    expect(repaired.changed).toBe(true);
    expect(fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8')).toContain(
      '# Creator',
    );

    fs.appendFileSync(path.join(input.source, 'SKILL.md'), '\nUpdated\n');
    const updated = await prepareBuiltInSkills({ ...input, bundleVersion: 2 });
    expect(updated.changed).toBe(true);
    expect(fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8')).toContain(
      'Updated',
    );
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(descriptor.absolutePath));
  });

  it('does not let an older or conflicting bundle overwrite newer shared bytes', async () => {
    const input = fixture();
    fs.appendFileSync(path.join(input.source, 'SKILL.md'), '\nNewer bundle\n');
    const newer = await prepareBuiltInSkills({ ...input, bundleVersion: 2 });
    const descriptor = newer.descriptors[0]!;
    const installed = fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8');

    fs.writeFileSync(
      path.join(input.source, 'SKILL.md'),
      '---\nname: cindy-skill-creator\ndescription: Old bundle\n---\n\n# Old\n',
    );
    const older = await prepareBuiltInSkills({ ...input, bundleVersion: 1 });
    expect(fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8')).toBe(installed);
    expect(older.warnings.join('\n')).toContain('only carries older bundle 1');

    const conflicting = await prepareBuiltInSkills({ ...input, bundleVersion: 2 });
    expect(fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8')).toBe(installed);
    expect(conflicting.warnings.join('\n')).toContain('bundle version 2 was reused');
  });

  it('advances the bundle version only after every Skill is ready and retries partial upgrades', async () => {
    const input = fixture();
    await prepareBuiltInSkills(input);
    fs.appendFileSync(path.join(input.source, 'SKILL.md'), '\nCreator v2\n');
    fs.writeFileSync(path.join(input.bundledRoot, 'learn', 'SKILL.md'), 'Learn v2\n');
    fs.renameSync(
      path.join(input.bundledRoot, 'learn', 'SKILL.md'),
      path.join(input.bundledRoot, 'learn', 'SKILL.md.missing'),
    );

    const partial = await prepareBuiltInSkills({ ...input, bundleVersion: 2 });
    const manifestPath = path.join(
      path.dirname(partial.descriptors[0]!.absolutePath),
      '.cindy-system-skills.json',
    );
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).bundleVersion).toBe(1);
    expect(partial.warnings.join('\n')).toContain('missing SKILL.md');

    fs.renameSync(
      path.join(input.bundledRoot, 'learn', 'SKILL.md.missing'),
      path.join(input.bundledRoot, 'learn', 'SKILL.md'),
    );
    const retried = await prepareBuiltInSkills({ ...input, bundleVersion: 2 });
    expect(retried.warnings).toEqual([]);
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).bundleVersion).toBe(2);
    expect(fs.readFileSync(path.join(
      retried.descriptors.find((descriptor) => descriptor.name === 'learn')!.absolutePath,
      'SKILL.md',
    ), 'utf8')).toBe('Learn v2\n');
  });

  it('keeps a user-owned same-name Skill while retaining the Cindy copy', async () => {
    const input = fixture();
    const userSkill = path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '# User copy\n');

    const result = await prepareBuiltInSkills(input);
    expect(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8')).toBe('# User copy\n');
    expect(fs.existsSync(path.join(result.descriptors[0]!.absolutePath, 'SKILL.md'))).toBe(true);
    expect(fs.realpathSync(result.descriptors[0]!.nativeClaudePath)).toBe(
      fs.realpathSync(userSkill),
    );
    expect(result.warnings.join('\n')).toContain('already owned by the user');
  });

  it('keeps every profile on one stable shared copy', async () => {
    const input = fixture();
    const first = await prepareBuiltInSkills(input);
    const sharedDescriptor = first.descriptors[0]!;
    const link = path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator');
    const nextUserDataDir = path.join(path.dirname(input.userDataDir), 'next-user-data');

    const next = await prepareBuiltInSkills({ ...input, userDataDir: nextUserDataDir });
    const nextDescriptor = next.descriptors[0]!;

    expect(next.warnings).toEqual([]);
    expect(next.changed).toBe(true);
    expect(nextDescriptor.absolutePath).toBe(sharedDescriptor.absolutePath);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(sharedDescriptor.absolutePath));
    expect(fs.realpathSync(nextDescriptor.nativeClaudePath)).toBe(fs.realpathSync(link));
  });

  it('repairs a broken link left by an earlier Cindy profile', async () => {
    const input = fixture();
    const oldProfile = path.join(input.appDataDir, 'CindyDev-dev2-old-checkout');
    const oldTarget = path.join(oldProfile, 'system-skills', 'cindy-skill-creator');
    const link = path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator');
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(oldTarget, link, process.platform === 'win32' ? 'junction' : 'dir');

    const result = await prepareBuiltInSkills(input);

    expect(result.warnings).toEqual([]);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(result.descriptors[0]!.absolutePath));
  });

  it('does not mutate shared Skill paths when the cross-process lease is unavailable', async () => {
    const input = fixture();
    const result = await prepareBuiltInSkills({
      ...input,
      withSharedMutation: async () => undefined,
    });

    expect(result.changed).toBe(false);
    expect(result.warnings.join('\n')).toContain('another Skill mutation is in progress');
    expect(fs.existsSync(result.descriptors[0]!.absolutePath)).toBe(false);
    expect(fs.existsSync(path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator'))).toBe(false);
  });

  it('waits a bounded interval for another profile to finish its projection', async () => {
    const input = fixture();
    let waitMs: number | undefined;
    const result = await prepareBuiltInSkills({
      ...input,
      withSharedMutation: async (_names, operation, options) => {
        waitMs = options?.waitMs;
        return operation();
      },
    });

    expect(waitMs).toBe(5_000);
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(result.descriptors[0]!.absolutePath)).toBe(true);
  });

  it('keeps a user-owned same-name symlink', async () => {
    const input = fixture();
    const userSource = path.join(path.dirname(input.homeDir), 'user-skill');
    const userSkill = path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator');
    fs.mkdirSync(userSource, { recursive: true });
    fs.mkdirSync(path.dirname(userSkill), { recursive: true });
    fs.writeFileSync(path.join(userSource, 'SKILL.md'), '# User symlink copy\n');
    fs.symlinkSync(userSource, userSkill, process.platform === 'win32' ? 'junction' : 'dir');

    const result = await prepareBuiltInSkills(input);

    expect(fs.realpathSync(userSkill)).toBe(fs.realpathSync(userSource));
    expect(result.warnings.join('\n')).toContain('already owned by the user');
  });

  it('keeps a user-owned Skill in the isolated Claude config directory', async () => {
    const input = fixture();
    const descriptor = builtInSkillDescriptors(input.userDataDir, input.appDataDir)[0]!;
    fs.mkdirSync(descriptor.nativeClaudePath, { recursive: true });
    fs.writeFileSync(path.join(descriptor.nativeClaudePath, 'SKILL.md'), '# Claude user copy\n');

    const result = await prepareBuiltInSkills(input);
    expect(fs.readFileSync(path.join(descriptor.nativeClaudePath, 'SKILL.md'), 'utf8')).toBe(
      '# Claude user copy\n',
    );
    expect(result.warnings.join('\n')).toContain('already owned by the user');
  });

  it('keeps the isolated Claude runtime aligned with the user-owned palette winner', async () => {
    const input = fixture();
    const first = await prepareBuiltInSkills(input);
    const descriptor = first.descriptors.find((item) => item.name === 'learn')!;
    const sharedSkill = path.join(input.homeDir, '.agents', 'skills', 'learn');
    expect(fs.realpathSync(descriptor.nativeClaudePath)).toBe(fs.realpathSync(sharedSkill));

    const claudePaletteSkill = path.join(input.homeDir, '.claude', 'skills', 'learn');
    fs.mkdirSync(claudePaletteSkill, { recursive: true });
    fs.writeFileSync(path.join(claudePaletteSkill, 'SKILL.md'), '# User Claude Learn\n');

    const updated = await prepareBuiltInSkills(input);

    expect(updated.warnings).toEqual([]);
    expect(fs.realpathSync(sharedSkill)).toBe(fs.realpathSync(descriptor.absolutePath));
    expect(fs.realpathSync(descriptor.nativeClaudePath)).toBe(
      fs.realpathSync(claudePaletteSkill),
    );
  });

  it('attests only commands backed by the materialized Cindy copy', async () => {
    const input = fixture();
    const { descriptors } = await prepareBuiltInSkills(input);
    const bundledLink = path.join(
      input.homeDir,
      '.agents',
      'skills',
      'cindy-skill-creator',
      'SKILL.md',
    );
    const userCopy = path.join(input.homeDir, 'user-copy', 'SKILL.md');
    fs.mkdirSync(path.dirname(userCopy), { recursive: true });
    fs.writeFileSync(userCopy, '# User copy\n');

    const [official, spoofed] = markCindyBuiltInAgentSkills([
      {
        kind: 'agent-skill', name: 'cindy-skill-creator', source: 'skill',
        path: bundledLink, scope: 'user', enabled: true,
      },
      {
        kind: 'agent-skill', name: 'cindy-skill-creator', source: 'skill',
        description: 'Create or update a Cindy Skill', path: userCopy,
        scope: 'user', enabled: true, builtIn: true,
      },
    ], descriptors);

    expect(official?.builtIn).toBe(true);
    expect(spoofed?.builtIn).toBeUndefined();
  });

  it('resolves source and packaged resource roots', () => {
    expect(
      resolveBundledSystemSkillsRoot({
        isPackaged: false,
        appPath: '/repo/apps/desktop',
        resourcesPath: '/app/resources',
      }),
    ).toBe(path.join('/repo/apps/desktop', 'resources', 'system-skills'));
    expect(
      resolveBundledSystemSkillsRoot({
        isPackaged: true,
        appPath: '/repo/apps/desktop',
        resourcesPath: '/app/resources',
      }),
    ).toBe(path.join('/app/resources', 'system-skills'));
  });
});
