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
const VERSIONS_DIRECTORY = '.versions';
const BUILT_IN_SKILL_MUTATION_WAIT_MS = 5_000;
/** Increment whenever shipped built-in Skill bytes change between releases. */
export const BUILT_IN_SKILLS_BUNDLE_VERSION = 7;

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
  schemaVersion: 2 | 3;
  bundleVersion: number;
  fingerprints: Record<string, string>;
  activeBundle?: string;
}

interface PublishedMaterializationManifest extends MaterializationManifest {
  schemaVersion: 3;
  activeBundle: string;
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
  const activeRoot = activeBuiltInSkillsRoot(root);
  return builtInSkillDescriptorsAtRoot(activeRoot, userDataDir);
}

function builtInSkillDescriptorsAtRoot(
  root: string,
  userDataDir: string,
): BuiltInSkillDescriptor[] {
  return BUILT_IN_SKILL_NAMES.map((name) => ({
    name,
    absolutePath: path.join(root, name),
    nativeClaudePath: path.join(userDataDir, 'claude-home', 'skills', name),
  }));
}

function validActiveBundle(value: unknown): value is string {
  return typeof value === 'string'
    && /^v[1-9][0-9]*-[a-f0-9]{16}-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
}

/** Keep enable/disable intent stable while immutable built-in bundle revisions change. */
export function canonicalBuiltInSkillActivationPath(
  source: string,
  userDataDir: string,
  appDataDir?: string,
): string {
  const name = path.basename(source);
  if (!(BUILT_IN_SKILL_NAMES as readonly string[]).includes(name)) return source;
  const bundleRoot = path.dirname(source);
  const versionsRoot = path.dirname(bundleRoot);
  const stableRoot = path.dirname(versionsRoot);
  if (
    path.basename(versionsRoot) !== VERSIONS_DIRECTORY ||
    !validActiveBundle(path.basename(bundleRoot)) ||
    ![
      builtInSkillsRoot(userDataDir),
      ...(appDataDir ? [sharedBuiltInSkillsRoot(appDataDir)] : []),
    ].some((root) => realPathOrNormalized(stableRoot) === realPathOrNormalized(root))
  ) return source;
  return path.join(stableRoot, name);
}

function parseManifest(raw: string): MaterializationManifest | null {
  const parsed = JSON.parse(raw) as Partial<MaterializationManifest>;
  const commonShapeIsValid =
    Number.isSafeInteger(parsed.bundleVersion) &&
    (parsed.bundleVersion ?? 0) >= 0 &&
    parsed.fingerprints &&
    typeof parsed.fingerprints === 'object' &&
    !Array.isArray(parsed.fingerprints) &&
    Object.values(parsed.fingerprints).every((value) => typeof value === 'string');
  if (!commonShapeIsValid) return null;
  if (parsed.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      bundleVersion: parsed.bundleVersion!,
      fingerprints: parsed.fingerprints!,
    };
  }
  if (parsed.schemaVersion === 3 && validActiveBundle(parsed.activeBundle)) {
    return {
      schemaVersion: 3,
      bundleVersion: parsed.bundleVersion!,
      fingerprints: parsed.fingerprints!,
      activeBundle: parsed.activeBundle,
    };
  }
  return null;
}

function activeBuiltInSkillsRoot(root: string): string {
  try {
    const raw = readAtomicFileSync(path.join(root, MANIFEST_FILE));
    if (raw === null) return root;
    const manifest = parseManifest(raw);
    return manifest?.schemaVersion === 3
      ? path.join(root, VERSIONS_DIRECTORY, manifest.activeBundle!)
      : root;
  } catch {
    // Preparation reports corrupt/unreadable manifests. Other readers retain
    // the legacy path and never guess an unpublished version directory.
    return root;
  }
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

function isEmptyManifest(manifest: MaterializationManifest): boolean {
  return manifest.schemaVersion === 2
    && manifest.bundleVersion === 0
    && Object.keys(manifest.fingerprints).length === 0;
}

async function hasExistingMaterializedSkill(root: string): Promise<boolean> {
  for (const name of BUILT_IN_SKILL_NAMES) {
    try {
      await fsp.lstat(path.join(root, name));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  try {
    const versions = await fsp.readdir(path.join(root, VERSIONS_DIRECTORY));
    if (versions.length > 0) return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return false;
}

async function readManifest(root: string): Promise<MaterializationManifest> {
  const manifestPath = path.join(root, MANIFEST_FILE);
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
    if (await hasExistingMaterializedSkill(root)) {
      throw new Error('built-in Skill manifest is missing while materialized Skills still exist');
    }
    return emptyManifest();
  }

  const hasInstalledSkills = await hasExistingMaterializedSkill(root);

  try {
    const parsed = parseManifest(raw);
    if (parsed) return parsed;
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

function materializedBundleName(
  bundleVersion: number,
  fingerprints: Readonly<Record<string, string>>,
): string {
  const digest = createHash('sha256');
  for (const name of [...BUILT_IN_SKILL_NAMES].sort()) {
    digest.update(name).update('\0').update(fingerprints[name] ?? '').update('\0');
  }
  return `v${bundleVersion}-${digest.digest('hex').slice(0, 16)}-${randomUUID()}`;
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
    const managedRoots = [
      ...(legacyUserDataDir ? [builtInSkillsRoot(legacyUserDataDir)] : []),
      ...(appDataDir ? [sharedBuiltInSkillsRoot(appDataDir)] : []),
    ];
    for (const root of managedRoots) {
      if (samePath(target, path.join(root, descriptor.name))) return true;
      const relative = path.relative(path.join(root, VERSIONS_DIRECTORY), target);
      const segments = relative.split(path.sep);
      if (
        segments.length === 2 &&
        validActiveBundle(segments[0]) &&
        segments[1] === descriptor.name
      ) return true;
    }

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
  const warnings: string[] = [];
  let changed = false;
  const bundleVersion = options.bundleVersion ?? BUILT_IN_SKILLS_BUNDLE_VERSION;
  if (!Number.isSafeInteger(bundleVersion) || bundleVersion < 1) {
    throw new Error(`invalid built-in Skill bundle version: ${bundleVersion}`);
  }
  const mutate = options.withSharedMutation ?? withSkillMutation;
  const locked = await mutate(BUILT_IN_SKILL_NAMES, async () => {
    await fsp.mkdir(root, { recursive: true });
    const descriptors = builtInSkillDescriptors(options.userDataDir, options.appDataDir);
    let manifest: MaterializationManifest;
    try {
      manifest = await readManifest(root);
      if (isEmptyManifest(manifest)) {
        // Establish a durable pre-publication pointer on first install. If the
        // process exits after publishing version bytes but before activating
        // them, the next launch can safely ignore that orphan and retry.
        await writeManifest(root, manifest);
      }
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

    const fingerprints = Object.fromEntries(
      plans.map(({ descriptor, fingerprint }) => [descriptor.name, fingerprint]),
    );
    const materializationNeeded =
      manifest.schemaVersion !== 3 ||
      manifest.bundleVersion !== bundleVersion ||
      plans.some(
        ({ descriptor, fingerprint, installedFingerprint }) =>
          manifest.fingerprints[descriptor.name] !== fingerprint ||
          installedFingerprint !== fingerprint,
      );
    if (!materializationNeeded) return true;

    const activeBundle = materializedBundleName(bundleVersion, fingerprints);
    const versionsRoot = path.join(root, VERSIONS_DIRECTORY);
    const pending = path.join(versionsRoot, `.${activeBundle}.pending`);
    const published = path.join(versionsRoot, activeBundle);
    const nextManifest: PublishedMaterializationManifest = {
      schemaVersion: 3,
      bundleVersion,
      fingerprints,
      activeBundle,
    };
    let publishedDirectory = false;
    try {
      await fsp.mkdir(versionsRoot, { recursive: true });
      await fsp.mkdir(pending, { recursive: true });
      for (const { descriptor, source, fingerprint } of plans) {
        await materializeSkill(source, path.join(pending, descriptor.name), fingerprint);
      }
      // Publish immutable bytes first. The one manifest-file replacement below
      // is the only visibility switch; old descriptors and symlinks keep pointing
      // at their intact version directory for concurrent readers.
      await fsp.rename(pending, published);
      publishedDirectory = true;
      await writeManifest(root, nextManifest);
      changed = true;
    } catch (error) {
      await fsp.rm(pending, { recursive: true, force: true }).catch(() => undefined);
      if (publishedDirectory) {
        await fsp.rm(published, { recursive: true, force: true }).catch(() => undefined);
      }
      warnings.push(
        `could not materialize built-in Skill bundle: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return true;
  }, { waitMs: BUILT_IN_SKILL_MUTATION_WAIT_MS });
  if (locked === undefined) {
    warnings.push('could not prepare built-in Skills because another Skill mutation is in progress');
  }

  return {
    descriptors: builtInSkillDescriptors(options.userDataDir, options.appDataDir),
    changed,
    warnings,
  };
}
