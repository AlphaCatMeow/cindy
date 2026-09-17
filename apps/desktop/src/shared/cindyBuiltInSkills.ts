export const CINDY_SKILL_CREATOR_NAME = 'cindy-skill-creator';

const CINDY_SKILL_CREATOR_SOURCE_DESCRIPTIONS = new Set([
  'Create or update a Cindy Skill',
  'Create or update a skill',
  'Create or update a Cindy Skill with appropriately scoped instructions and any needed supporting resources.',
]);

/** Identify Cindy-owned metadata without treating another vendor's Skill Creator as official. */
export function isCindyBuiltInSkillMetadata(skill: {
  builtIn?: boolean;
  name: string;
  description?: string;
  scope?: string;
}): boolean {
  if (skill.name !== CINDY_SKILL_CREATOR_NAME) return false;
  if (skill.builtIn === true || skill.scope === 'system') return true;
  return Boolean(
    skill.description
    && CINDY_SKILL_CREATOR_SOURCE_DESCRIPTIONS.has(skill.description.trim()),
  );
}
