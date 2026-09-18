export const CINDY_SKILL_CREATOR_NAME = 'cindy-skill-creator';
export const CINDY_LEARN_NAME = 'learn';

const CINDY_SKILL_CREATOR_SOURCE_DESCRIPTIONS = new Set([
  'Create or update a Cindy Skill',
  'Create or update a skill',
  'Create or update a Cindy Skill with appropriately scoped instructions and any needed supporting resources.',
]);

export const CINDY_LEARN_SOURCE_DESCRIPTION =
  "Distill a reusable Cindy Skill from the current task, a described workflow, or a SkillHub skill through Cindy's review flow when the user invokes /learn or explicitly asks to start Learn.";

const CINDY_LEARN_SOURCE_DESCRIPTIONS = new Set([
  CINDY_LEARN_SOURCE_DESCRIPTION,
  'Distill a reusable Skill with Cindy',
]);

const CINDY_BUILT_IN_SOURCE_DESCRIPTIONS = new Map<string, ReadonlySet<string>>([
  [CINDY_SKILL_CREATOR_NAME, CINDY_SKILL_CREATOR_SOURCE_DESCRIPTIONS],
  [CINDY_LEARN_NAME, CINDY_LEARN_SOURCE_DESCRIPTIONS],
]);

/** Identify Cindy-owned metadata without treating another vendor's Skill Creator as official. */
export function isCindyBuiltInSkillMetadata(skill: {
  builtIn?: boolean;
  name: string;
  description?: string;
  scope?: string;
}): boolean {
  const sourceDescriptions = CINDY_BUILT_IN_SOURCE_DESCRIPTIONS.get(skill.name);
  if (!sourceDescriptions) return false;
  if (skill.builtIn === true || skill.scope === 'system') return true;
  return Boolean(
    skill.description
    && sourceDescriptions.has(skill.description.trim()),
  );
}
