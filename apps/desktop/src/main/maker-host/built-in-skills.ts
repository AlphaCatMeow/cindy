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
import { atomicWriteFileSync, readAtomicFileSync } from '../utils/atomicWriteFile';

export const BUILT_IN_SKILL_CREATOR_NAME = CINDY_SKILL_CREATOR_NAME;
export const BUILT_IN_LEARN_SKILL_NAME = CINDY_LEARN_NAME;

const BUILT_IN_SKILL_NAMES = [BUILT_IN_SKILL_CREATOR_NAME, BUILT_IN_LEARN_SKILL_NAME] as const;
const MANIFEST_FILE = '.cindy-system-skills.json';
const BUILT_IN_SKILL_MUTATION_WAIT_MS = 5_000;
/** Increment whenever shipped built-in Skill bytes change between releases. */
export const BUILT_IN_SKILLS_BUNDLE_VERSION = 5;

export interface BuiltInSkillDescriptor {
  name: string;
  absolutePath: string;
  nativeClaudePath: string;
}

export interface PrepareBuiltInSkillsOptions {
  bundledRoot: string;
  userDataDir: string;
  appDataDir?: string;
  bundleVersion?: number;
  withSharedMutation?: typeof withSkillMutation;
}

export interface PrepareBuiltInSkillsResult {
  descriptors: BuiltInSkillDescriptor[];
  changed: boolean;
  warnings: string[];
}

export interface RefreshBuiltInClaudeSkillLinksOptions {
  userDataDir: string;
  appDataDir?: string;
  homeDir?: string;
  descriptors?: readonly BuiltInSkillDescriptor[];
  withSharedMutation?: typeof withSkillMutation;
}

export interface RefreshBuiltInSharedSkillLinksOptions {
  userDataDir: string;
  appDataDir?: string;
  homeDir?: string;
  descriptors?: readonly BuiltInSkillDescriptor[];
  withSharedMutation?: typeof withSkillMutation;
}

export interface RefreshBuiltInClaudeSkillLinksResult {
  changed: boolean;
  warnings: string[];
}

export type RefreshBuiltInSharedSkillLinksResult = RefreshBuiltInClaudeSkillLinksResult;

interface MaterializationManifest {
  schemaVersion: 2;
  bundleVersion: number;
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

function emptyManifest(): MaterializationManifest {
  return { schemaVersion: 2, bundleVersion: 0, fingerprints: {} };
}

async function hasExistingMaterializedSkill(
  descriptors: readonly BuiltInSkillDescriptor[],
): Promise<boolean> {
  for (const descriptor of descriptors) {
    try {
      await fsp.lstat(descriptor.absolutePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function readManifest(
  root: string,
  descriptors: readonly BuiltInSkillDescriptor[],
): Promise<MaterializationManifest> {
  const manifestPath = path.join(root, MANIFEST_FILE);
  const hasInstalledSkills = await hasExistingMaterializedSkill(descriptors);
  let raw: string | null;
  try {
    raw = readAtomicFileSync(manifestPath);
  } catch (error) {
    throw new Error(
      `could not read built-in Skill manifest without risking a downgrade: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (raw === null) {
    if (hasInstalledSkills) {
      throw new Error('built-in Skill manifest is missing while materialized Skills still exist');
    }
    return emptyManifest();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<MaterializationManifest>;
    if (
      parsed.schemaVersion === 2 &&
      Number.isSafeInteger(parsed.bundleVersion) &&
      (parsed.bundleVersion ?? 0) >= 0 &&
      parsed.fingerprints &&
      typeof parsed.fingerprints === 'object' &&
      !Array.isArray(parsed.fingerprints) &&
      Object.values(parsed.fingerprints).every((value) => typeof value === 'string')
    ) {
      return {
        schemaVersion: 2,
        bundleVersion: parsed.bundleVersion!,
        fingerprints: parsed.fingerprints,
      };
    }
  } catch (error) {
    if (hasInstalledSkills) {
      throw new Error(
        `built-in Skill manifest is invalid while materialized Skills still exist: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return emptyManifest();
  }
  if (hasInstalledSkills) {
    throw new Error(
      'built-in Skill manifest has an invalid shape while materialized Skills still exist',
    );
  }
  return emptyManifest();
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
  desiredTarget = descriptor.absolutePath,
  additionalManagedTargets: readonly string[] = [],
): Promise<{ changed: boolean; warning?: string; targetPath?: string }> {
  await fsp.mkdir(path.dirname(linkPath), { recursive: true });

  let currentTarget: string | undefined;
  try {
    const current = await fsp.realpath(linkPath);
    currentTarget = current;
    const expected = await fsp.realpath(desiredTarget);
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
        additionalManagedTargets,
      )
    ) {
      await fsp.unlink(linkPath);
      await fsp.symlink(
        desiredTarget,
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
    desiredTarget,
    linkPath,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return { changed: true, targetPath: desiredTarget };
}

async function isCindyManagedSystemSkillTarget(
  linkPath: string,
  descriptor: BuiltInSkillDescriptor,
  legacyUserDataDir?: string,
  appDataDir?: string,
  additionalManagedTargets: readonly string[] = [],
): Promise<boolean> {
  try {
    const rawTarget = await fsp.readlink(linkPath);
    const target = path.isAbsolute(rawTarget)
      ? rawTarget
      : path.resolve(path.dirname(linkPath), rawTarget);
    if (samePath(target, descriptor.absolutePath)) return true;
    if (additionalManagedTargets.some((managedTarget) => samePath(target, managedTarget))) {
      return true;
    }
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

async function refreshBuiltInSharedSkillLinksUnlocked(
  options: Omit<RefreshBuiltInSharedSkillLinksOptions, 'withSharedMutation'>,
): Promise<RefreshBuiltInSharedSkillLinksResult> {
  const descriptors = options.descriptors
    ?? builtInSkillDescriptors(options.userDataDir, options.appDataDir);
  const homeDir = options.homeDir ?? os.homedir();
  const warnings: string[] = [];
  let changed = false;

  for (const descriptor of descriptors) {
    try {
      const linked = await ensureSharedEntry(
        descriptor,
        homeDir,
        options.userDataDir,
        options.appDataDir,
      );
      changed = linked.changed || changed;
      if (linked.warning) warnings.push(linked.warning);
    } catch (error) {
      warnings.push(
        `could not expose built-in Skill ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { changed, warnings };
}

/** Refresh the home-level shared projection. Call only inside the stable owner boundary. */
export async function refreshBuiltInSharedSkillLinks(
  options: RefreshBuiltInSharedSkillLinksOptions,
): Promise<RefreshBuiltInSharedSkillLinksResult> {
  const descriptors = options.descriptors
    ?? builtInSkillDescriptors(options.userDataDir, options.appDataDir);
  const mutate = options.withSharedMutation ?? withSkillMutation;
  const refreshed = await mutate(
    descriptors.map((descriptor) => descriptor.name),
    () => refreshBuiltInSharedSkillLinksUnlocked({ ...options, descriptors }),
    { waitMs: BUILT_IN_SKILL_MUTATION_WAIT_MS },
  );
  return refreshed ?? {
    changed: false,
    warnings: ['could not expose built-in Skills because another Skill mutation is in progress'],
  };
}

function realPathOrNormalized(value: string): string {
  try { return normalizeForCompare(fs.realpathSync.native(value)); }
  catch { return normalizeForCompare(value); }
}

async function hasSkillFile(skillDir: string): Promise<boolean> {
  for (const fileName of ['SKILL.md', 'skill.md']) {
    if ((await fsp.stat(path.join(skillDir, fileName)).catch(() => null))?.isFile()) {
      return true;
    }
  }
  return false;
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

/** Mark trusted Cindy entries, then apply the live activation override to those entries only. */
export function activeCindyBuiltInAgentSkills(
  skills: readonly AgentSkillCommand[],
  descriptors: readonly BuiltInSkillDescriptor[],
  isEnabled: (source: string) => boolean,
): AgentSkillCommand[] {
  const descriptorsByName = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  return markCindyBuiltInAgentSkills(skills, descriptors).filter((skill) => {
    if (skill.builtIn !== true) return true;
    const descriptor = descriptorsByName.get(skill.name);
    return descriptor ? isEnabled(descriptor.absolutePath) : false;
  });
}

async function refreshBuiltInClaudeSkillLinksUnlocked(
  options: Omit<RefreshBuiltInClaudeSkillLinksOptions, 'withSharedMutation'>,
): Promise<RefreshBuiltInClaudeSkillLinksResult> {
  const descriptors = options.descriptors
    ?? builtInSkillDescriptors(options.userDataDir, options.appDataDir);
  const homeDir = options.homeDir ?? os.homedir();
  const warnings: string[] = [];
  let changed = false;

  for (const descriptor of descriptors) {
    const sharedPath = path.join(homeDir, '.agents', 'skills', descriptor.name);
    const claudePalettePath = path.join(homeDir, '.claude', 'skills', descriptor.name);
    const claudeRuntimeTarget = await hasSkillFile(claudePalettePath)
      ? claudePalettePath
      : sharedPath;
    if (!(await hasSkillFile(claudeRuntimeTarget))) {
      warnings.push(
        `could not expose built-in Skill ${descriptor.name} to Claude because its palette winner is unavailable`,
      );
      continue;
    }
    try {
      const linked = await ensureSkillEntry(
        descriptor,
        descriptor.nativeClaudePath,
        true,
        options.userDataDir,
        options.appDataDir,
        claudeRuntimeTarget,
        [sharedPath, claudePalettePath],
      );
      changed = linked.changed || changed;
      if (linked.warning) warnings.push(linked.warning);
    } catch (error) {
      warnings.push(
        `could not expose built-in Skill ${descriptor.name} to Claude: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { changed, warnings };
}

/** Keep Cindy's isolated Claude runtime pointed at the latest shared/palette winner. */
export async function refreshBuiltInClaudeSkillLinks(
  options: RefreshBuiltInClaudeSkillLinksOptions,
): Promise<RefreshBuiltInClaudeSkillLinksResult> {
  const descriptors = options.descriptors
    ?? builtInSkillDescriptors(options.userDataDir, options.appDataDir);
  const mutate = options.withSharedMutation ?? withSkillMutation;
  const refreshed = await mutate(
    descriptors.map((descriptor) => descriptor.name),
    () => refreshBuiltInClaudeSkillLinksUnlocked({ ...options, descriptors }),
    { waitMs: BUILT_IN_SKILL_MUTATION_WAIT_MS },
  );
  return refreshed ?? {
    changed: false,
    warnings: ['could not refresh built-in Claude Skills because another Skill mutation is in progress'],
  };
}

/**
 * Materialize Cindy-owned Skill bytes under a profile-independent appData path.
 * Home-level discovery links are refreshed separately inside the stable owner boundary.
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
  const bundleVersion = options.bundleVersion ?? BUILT_IN_SKILLS_BUNDLE_VERSION;
  if (!Number.isSafeInteger(bundleVersion) || bundleVersion < 1) {
    throw new Error(`invalid built-in Skill bundle version: ${bundleVersion}`);
  }
  const mutate = options.withSharedMutation ?? withSkillMutation;
  const locked = await mutate(BUILT_IN_SKILL_NAMES, async () => {
    await fsp.mkdir(root, { recursive: true });
    let manifest: MaterializationManifest;
    try {
      manifest = await readManifest(root, descriptors);
    } catch (error) {
      warnings.push(
        `kept existing built-in Skills because their manifest is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
    const newerBundleIsInstalled = manifest.bundleVersion > bundleVersion;
    if (newerBundleIsInstalled) {
      warnings.push(
        `kept built-in Skill bundle ${manifest.bundleVersion}; this build only carries older bundle ${bundleVersion}`,
      );
      return true;
    }

    const plans: Array<{
      descriptor: BuiltInSkillDescriptor;
      source: string;
      fingerprint: string;
      installedFingerprint: string | null;
    }> = [];
    for (const descriptor of descriptors) {
      const source = path.join(options.bundledRoot, descriptor.name);
      try {
        if (!(await fsp.stat(path.join(source, 'SKILL.md')).catch(() => null))?.isFile()) {
          throw new Error(`bundled Skill is missing SKILL.md: ${source}`);
        }
        const fingerprint = await hashDirectory(source);
        const installedFingerprint = await hashDirectory(descriptor.absolutePath).catch(
          () => null,
        );
        const recordedFingerprint = manifest.fingerprints[descriptor.name];
        const sameVersionConflict =
          manifest.bundleVersion === bundleVersion &&
          recordedFingerprint !== undefined &&
          recordedFingerprint !== fingerprint;
        if (sameVersionConflict) {
          warnings.push(
            `kept built-in Skill ${descriptor.name} because bundle version ${bundleVersion} was reused for different bytes`,
          );
          continue;
        }
        plans.push({ descriptor, source, fingerprint, installedFingerprint });
      } catch (error) {
        warnings.push(
          `could not materialize built-in Skill ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    if (plans.length !== descriptors.length) return true;

    const nextManifest: MaterializationManifest = {
      schemaVersion: 2,
      bundleVersion,
      fingerprints: Object.fromEntries(
        plans.map(({ descriptor, fingerprint }) => [descriptor.name, fingerprint]),
      ),
    };
    const manifestNeedsUpdate =
      manifest.bundleVersion !== bundleVersion ||
      plans.some(
        ({ descriptor, fingerprint }) => manifest.fingerprints[descriptor.name] !== fingerprint,
      );
    if (manifestNeedsUpdate) {
      try {
        // Commit the version/fingerprints before swapping any directories. If a
        // later materialization is interrupted, old builds see the newer version
        // and cannot downgrade the bytes; this build repairs them on its next run.
        await writeManifest(root, nextManifest);
        manifest = nextManifest;
        changed = true;
      } catch (error) {
        warnings.push(
          `could not save built-in Skill manifest: ${error instanceof Error ? error.message : String(error)}`,
        );
        return true;
      }
    }

    for (const { descriptor, source, fingerprint, installedFingerprint } of plans) {
      if (
        installedFingerprint === fingerprint &&
        manifest.fingerprints[descriptor.name] === fingerprint
      ) continue;
      try {
        changed =
          (await materializeSkill(source, descriptor.absolutePath, fingerprint)) || changed;
      } catch (error) {
        warnings.push(
          `could not materialize built-in Skill ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return true;
  }, { waitMs: BUILT_IN_SKILL_MUTATION_WAIT_MS });
  if (locked === undefined) {
    warnings.push('could not prepare built-in Skills because another Skill mutation is in progress');
  }

  return { descriptors, changed, warnings };
}
