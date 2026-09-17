import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  builtInSkillDescriptors,
  prepareBuiltInSkills,
  resolveBundledSystemSkillsRoot,
} from '../built-in-skills';

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-built-in-skills-'));
  roots.push(root);
  const bundledRoot = path.join(root, 'resources', 'system-skills');
  const source = path.join(bundledRoot, 'cindy-skill-creator');
  const userDataDir = path.join(root, 'user-data');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: cindy-skill-creator\ndescription: Create Skills\n---\n\n# Creator\n',
  );
  fs.writeFileSync(path.join(source, 'scripts', 'validate.py'), 'print("ok")\n');
  return { bundledRoot, source, userDataDir, homeDir };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('built-in Skills', () => {
  it('materializes versioned bytes at a stable path and exposes them through the shared root', async () => {
    const input = fixture();
    const first = await prepareBuiltInSkills(input);
    const descriptor = builtInSkillDescriptors(input.userDataDir)[0]!;
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

    const second = await prepareBuiltInSkills(input);
    expect(second.changed).toBe(false);

    fs.writeFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), '# Tampered\n');
    const repaired = await prepareBuiltInSkills(input);
    expect(repaired.changed).toBe(true);
    expect(fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8')).toContain(
      '# Creator',
    );

    fs.appendFileSync(path.join(input.source, 'SKILL.md'), '\nUpdated\n');
    const updated = await prepareBuiltInSkills(input);
    expect(updated.changed).toBe(true);
    expect(fs.readFileSync(path.join(descriptor.absolutePath, 'SKILL.md'), 'utf8')).toContain(
      'Updated',
    );
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(descriptor.absolutePath));
  });

  it('keeps a user-owned same-name Skill while retaining the Cindy copy', async () => {
    const input = fixture();
    const userSkill = path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '# User copy\n');

    const result = await prepareBuiltInSkills(input);
    expect(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8')).toBe('# User copy\n');
    expect(fs.existsSync(path.join(result.descriptors[0]!.absolutePath, 'SKILL.md'))).toBe(true);
    expect(result.warnings.join('\n')).toContain('already owned by the user');
  });

  it('repoints a shared link owned by another Cindy profile', async () => {
    const input = fixture();
    const first = await prepareBuiltInSkills(input);
    const oldDescriptor = first.descriptors[0]!;
    const link = path.join(input.homeDir, '.agents', 'skills', 'cindy-skill-creator');
    const nextUserDataDir = path.join(path.dirname(input.userDataDir), 'next-user-data');

    const next = await prepareBuiltInSkills({ ...input, userDataDir: nextUserDataDir });
    const nextDescriptor = next.descriptors[0]!;

    expect(next.warnings).toEqual([]);
    expect(next.changed).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(nextDescriptor.absolutePath));
    expect(fs.existsSync(path.join(oldDescriptor.absolutePath, 'SKILL.md'))).toBe(true);
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
    const descriptor = builtInSkillDescriptors(input.userDataDir)[0]!;
    fs.mkdirSync(descriptor.nativeClaudePath, { recursive: true });
    fs.writeFileSync(path.join(descriptor.nativeClaudePath, 'SKILL.md'), '# Claude user copy\n');

    const result = await prepareBuiltInSkills(input);
    expect(fs.readFileSync(path.join(descriptor.nativeClaudePath, 'SKILL.md'), 'utf8')).toBe(
      '# Claude user copy\n',
    );
    expect(result.warnings.join('\n')).toContain('already owned by the user');
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
