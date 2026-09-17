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
  const source = path.join(bundledRoot, 'skill-creator');
  const userDataDir = path.join(root, 'user-data');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'SKILL.md'),
    '---\nname: skill-creator\ndescription: Create Skills\n---\n\n# Creator\n',
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
    const link = path.join(input.homeDir, '.agents', 'skills', 'skill-creator');
    expect(first.changed).toBe(true);
    expect(first.warnings).toEqual([]);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(descriptor.absolutePath));
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
    const userSkill = path.join(input.homeDir, '.agents', 'skills', 'skill-creator');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), '# User copy\n');

    const result = await prepareBuiltInSkills(input);
    expect(fs.readFileSync(path.join(userSkill, 'SKILL.md'), 'utf8')).toBe('# User copy\n');
    expect(fs.existsSync(path.join(result.descriptors[0]!.absolutePath, 'SKILL.md'))).toBe(true);
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
