import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentSkillCommand } from '@cindy/maker-core';
import {
  CINDY_LEARN_NAME,
  CINDY_SKILL_CREATOR_NAME,
} from '../../shared/cindyBuiltInSkills';
import { withSkillMutation } from '../skillhub/sharedMutationLease';
import { atomicWriteFileSync } from '../utils/atomicWriteFile';

export const BUILT_IN_SKILL_CREATOR_NAME = CINDY_SKILL_CREATOR_NAME;
export const BUILT_IN_LEARN_SKILL_NAME = CINDY_LEARN_NAME;

const BUILT_IN_SKILL_NAMES = [BUILT_IN_SKILL_CREATOR_NAME, BUILT_IN_LEARN_SKILL_NAME] as const;
const MANIFEST_FILE = '.cindy-system-skills.json';
const BUILT_IN_SKILL_MUTATION_WAIT_MS = 5_000;

export interface BuiltInSkillDescriptor {
  name: string;
  absolutePath: string;
  nativeClaudePath: string;
}

export interface PrepareBuiltInSkillsOptions {
  bundledRoot: string;
  userDataDir: string;
  appDataDir?: string;
  homeDir?: string;
  withSharedMutation?: typeof withSkillMutation;
}

export interface PrepareBuiltInSkillsResult {
  descriptors: BuiltInSkillDescriptor[];
  changed: boolean;
  warnings: string[];
}

interface MaterializationManifest {
  schemaVersion: 1;
  fingerprints: Record<string, string>;
}

export function resolveBundledSystemSkillsRoot(input: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  return input.isPackaged
    ? path.join(input.resourcesPath, 'system-skills')
    : path.join(input.appPath, 'resources', 'system-skills');
}

export function builtInSkillsRoot(userDataDir: string): string {
  return path.join(userDataDir, 'system-skills');
}

/** Profile-independent storage shared by Global, China, dev, and isolated profiles. */
export function sharedBuiltInSkillsRoot(appDataDir: string): string {
  return path.join(appDataDir, 'Cindy', 'shared-system-skills');
}

export function builtInSkillDescriptors(
  userDataDir: string,
  appDataDir?: string,
): BuiltInSkillDescriptor[] {
  const root = appDataDir
    ? sharedBuiltInSkillsRoot(appDataDir)
    : builtInSkillsRoot(userDataDir);
  return BUILT_IN_SKILL_NAMES.map((name) => ({
    name,
    absolutePath: path.join(root, name),
    nativeClaudePath: path.join(userDataDir, 'claude-home', 'skills', name),
  }));
}

async function hashDirectory(root: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      hash.update(entry.isDirectory() ? `d\0${relative}\0` : `f\0${relative}\0`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) hash.update(await fsp.readFile(absolute));
      else throw new Error(`unsupported bundled Skill entry: ${relative}`);
    }
  };
  await visit(root);
  return hash.digest('hex');
}

async function readManifest(root: string): Promise<MaterializationManifest> {
  try {
    const parsed = JSON.parse(
      await fsp.readFile(path.join(root, MANIFEST_FILE), 'utf8'),
    ) as Partial<MaterializationManifest>;
    if (
      parsed.schemaVersion === 1 &&
      parsed.fingerprints &&
      typeof parsed.fingerprints === 'object'
    ) {
      return { schemaVersion: 1, fingerprints: parsed.fingerprints };
    }
  } catch {
    // Missing or unreadable app-owned metadata is repaired from bundled bytes.
  }
  return { schemaVersion: 1, fingerprints: {} };
}

async function writeManifest(root: string, manifest: MaterializationManifest): Promise<void> {
  const destination = path.join(root, MANIFEST_FILE);
  atomicWriteFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function materializeSkill(
  source: string,
  destination: string,
  expectedFingerprint: string,
): Promise<boolean> {
  const skillFile = path.join(source, 'SKILL.md');
  if (!(await fsp.stat(skillFile).catch(() => null))?.isFile()) {
    throw new Error(`bundled Skill is missing SKILL.md: ${source}`);
  }

  const root = path.dirname(destination);
  const stage = path.join(root, `.${path.basename(destination)}.stage-${randomUUID()}`);
  const backup = path.join(root, `.${path.basename(destination)}.backup-${randomUUID()}`);
  await fsp.cp(source, stage, { recursive: true, force: true, errorOnExist: false });
  const stagedFingerprint = await hashDirectory(stage).catch(() => null);
  if (stagedFingerprint !== expectedFingerprint) {
    await fsp.rm(stage, { recursive: true, force: true });
    throw new Error(`staged Skill fingerprint mismatch: ${path.basename(destination)}`);
  }
  let movedExisting = false;
  try {
    if (fs.existsSync(destination)) {
      await fsp.rename(destination, backup);
      movedExisting = true;
    }
    await fsp.rename(stage, destination);
  } catch (error) {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => undefined);
    if (movedExisting && !fs.existsSync(destination)) {
      await fsp.rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }
  if (movedExisting) await fsp.rm(backup, { recursive: true, force: true });
  return true;
}

async function ensureSkillEntry(
  descriptor: BuiltInSkillDescriptor,
  linkPath: string,
  replaceStaleCindyLink = false,
  legacyUserDataDir?: string,
  appDataDir?: string,
): Promise<{ changed: boolean; warning?: string; targetPath?: string }> {
  await fsp.mkdir(path.dirname(linkPath), { recursive: true });

  let currentTarget: string | undefined;
  try {
    const current = await fsp.realpath(linkPath);
    currentTarget = current;
    const expected = await fsp.realpath(descriptor.absolutePath);
    if (samePath(current, expected)) return { changed: false };
  } catch {
    // Inspect the lexical entry below; a missing entry may be created.
  }

  try {
    const stat = await fsp.lstat(linkPath);
    if (
      replaceStaleCindyLink &&
      stat.isSymbolicLink() &&
      await isCindyManagedSystemSkillTarget(
        linkPath,
        descriptor,
        legacyUserDataDir,
        appDataDir,
      )
    ) {
      await fsp.unlink(linkPath);
      await fsp.symlink(
        descriptor.absolutePath,
        linkPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      return { changed: true };
    }
    return {
      changed: false,
      warning: `built-in Skill ${descriptor.name} was not linked because ${linkPath} is already owned by the user`,
      ...(currentTarget ? { targetPath: currentTarget } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await fsp.symlink(
    descriptor.absolutePath,
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return { changed: true, targetPath: descriptor.absolutePath };
}

async function isCindyManagedSystemSkillTarget(
  linkPath: string,
  descriptor: BuiltInSkillDescriptor,
  legacyUserDataDir?: string,
  appDataDir?: string,
): Promise<boolean> {
  try {
    const rawTarget = await fsp.readlink(linkPath);
    const target = path.isAbsolute(rawTarget)
      ? rawTarget
      : path.resolve(path.dirname(linkPath), rawTarget);
    if (samePath(target, descriptor.absolutePath)) return true;
    if (
      legacyUserDataDir &&
      samePath(target, path.join(builtInSkillsRoot(legacyUserDataDir), descriptor.name))
    ) return true;

    const targetRoot = path.dirname(target);
    if (
      path.basename(target) !== descriptor.name ||
      path.basename(targetRoot) !== 'system-skills'
    ) {
      return false;
    }

    // Migrate links created by the first implementation even after their old
    // profile directory was deleted. The exact appData child + Cindy profile
    // shape is deliberately narrower than an arbitrary `system-skills` link.
    if (appDataDir) {
      const profileDir = path.dirname(targetRoot);
      const profileName = path.basename(profileDir);
      if (
        samePath(path.dirname(profileDir), appDataDir) &&
        /^Cindy(?:Global|Dev)?(?:[-.][A-Za-z0-9._-]+)?$/.test(profileName)
      ) return true;
    }

    return false;
  } catch {
    return false;
  }
}

function normalizeForCompare(value: string): string {
  const withoutWindowsNamespace = process.platform === 'win32'
    ? value.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
    : value;
  const resolved = path.resolve(withoutWindowsNamespace);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return normalizeForCompare(left) === normalizeForCompare(right);
}

async function ensureSharedEntry(
  descriptor: BuiltInSkillDescriptor,
  homeDir: string,
  legacyUserDataDir: string,
  appDataDir?: string,
): Promise<{ changed: boolean; warning?: string; targetPath?: string }> {
  return ensureSkillEntry(
    descriptor,
    path.join(homeDir, '.agents', 'skills', descriptor.name),
    true,
    legacyUserDataDir,
    appDataDir,
  );
}

function realPathOrNormalized(value: string): string {
  try { return normalizeForCompare(fs.realpathSync.native(value)); }
  catch { return normalizeForCompare(value); }
}

/** Main-owned attestation used by the renderer; names and descriptions are not trusted. */
export function markCindyBuiltInAgentSkills(
  skills: readonly AgentSkillCommand[],
  descriptors: readonly BuiltInSkillDescriptor[],
): AgentSkillCommand[] {
  const trustedSkillFiles = new Map(descriptors.map((descriptor) => [
    descriptor.name,
    realPathOrNormalized(path.join(descriptor.absolutePath, 'SKILL.md')),
  ]));
  return skills.map((skill) => {
    const trustedPath = trustedSkillFiles.get(skill.name);
    const builtIn = Boolean(skill.path && trustedPath && realPathOrNormalized(skill.path) === trustedPath);
    if (builtIn) return { ...skill, builtIn: true };
    if (skill.builtIn === undefined) return skill;
    const { builtIn: _untrusted, ...rest } = skill;
    return rest;
  });
}

/**
 * Materialize Cindy-owned Skill bytes under a profile-independent appData path, then expose
 * them through the shared ~/.agents discovery root and Cindy's isolated Claude
 * config directory without replacing user data.
 */
export async function prepareBuiltInSkills(
  options: PrepareBuiltInSkillsOptions,
): Promise<PrepareBuiltInSkillsResult> {
  const root = options.appDataDir
    ? sharedBuiltInSkillsRoot(options.appDataDir)
    : builtInSkillsRoot(options.userDataDir);
  const descriptors = builtInSkillDescriptors(options.userDataDir, options.appDataDir);
  const warnings: string[] = [];
  let changed = false;
  const mutate = options.withSharedMutation ?? withSkillMutation;
  const locked = await mutate(BUILT_IN_SKILL_NAMES, async () => {
    await fsp.mkdir(root, { recursive: true });
    const manifest = await readManifest(root);

    for (const descriptor of descriptors) {
      const source = path.join(options.bundledRoot, descriptor.name);
      try {
        const fingerprint = await hashDirectory(source);
        const installedFingerprint = await hashDirectory(descriptor.absolutePath).catch(() => null);
        if (
          installedFingerprint !== fingerprint ||
          manifest.fingerprints[descriptor.name] !== fingerprint
        ) {
          changed = (await materializeSkill(source, descriptor.absolutePath, fingerprint)) || changed;
          manifest.fingerprints[descriptor.name] = fingerprint;
        }
      } catch (error) {
        warnings.push(
          `could not materialize built-in Skill ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      const sharedPath = path.join(
        options.homeDir ?? os.homedir(),
        '.agents',
        'skills',
        descriptor.name,
      );
      let sharedTarget: string | undefined;
      try {
        const linked = await ensureSharedEntry(
          descriptor,
          options.homeDir ?? os.homedir(),
          options.userDataDir,
          options.appDataDir,
        );
        changed = linked.changed || changed;
        sharedTarget = linked.targetPath ?? await fsp.realpath(sharedPath).catch(() => undefined);
        if (linked.warning) warnings.push(linked.warning);
      } catch (error) {
        warnings.push(
          `could not expose built-in Skill ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!sharedTarget) {
        warnings.push(`could not expose built-in Skill ${descriptor.name} to Claude because the shared entry is unavailable`);
        continue;
      }
      try {
        // Point at the shared name instead of a profile copy. If a user owns
        // that name, Claude, Codex, and Pi all execute the same winner.
        const linked = await ensureSkillEntry(
          { ...descriptor, absolutePath: sharedPath },
          descriptor.nativeClaudePath,
          true,
          options.userDataDir,
          options.appDataDir,
        );
        changed = linked.changed || changed;
        if (linked.warning) warnings.push(linked.warning);
      } catch (error) {
        warnings.push(
          `could not expose built-in Skill ${descriptor.name} to Claude: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    try {
      await writeManifest(root, manifest);
    } catch (error) {
      warnings.push(
        `could not save built-in Skill manifest: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return true;
  }, { waitMs: BUILT_IN_SKILL_MUTATION_WAIT_MS });
  if (locked === undefined) {
    warnings.push('could not prepare built-in Skills because another Skill mutation is in progress');
  }

  return { descriptors, changed, warnings };
}
