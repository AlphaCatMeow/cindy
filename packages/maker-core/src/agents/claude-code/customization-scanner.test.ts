import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scanClaudeRuntimeSkills } from './customization-scanner.js';

const roots: string[] = [];

function writeSkill(root: string, name: string): string {
  const skillDir = path.join(root, 'skills', name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}\n---\n`,
  );
  return skillDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('scanClaudeRuntimeSkills', () => {
  it('uses the child runtime config directory for global Skills', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-runtime-skills-'));
    roots.push(root);
    const home = path.join(root, 'home');
    const isolatedConfig = path.join(root, 'user-data', 'claude-home');
    const workingDir = path.join(root, 'project');
    fs.mkdirSync(path.join(workingDir, '.git'), { recursive: true });
    writeSkill(path.join(home, '.claude'), 'default-home');
    const isolatedSkill = writeSkill(isolatedConfig, 'isolated-home');
    const projectSkill = writeSkill(path.join(workingDir, '.claude'), 'project-skill');
    vi.spyOn(os, 'homedir').mockReturnValue(home);

    const result = await scanClaudeRuntimeSkills(workingDir, isolatedConfig);

    expect(result.items.map((item) => item.name)).toEqual([
      'isolated-home',
      'project-skill',
    ]);
    expect(result.items.map((item) => item.absolutePath)).toEqual([
      isolatedSkill,
      fs.realpathSync(projectSkill),
    ]);
  });
});
