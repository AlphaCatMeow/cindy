const SKILL_CREATOR_NAME = 'skill-creator';
const SKILL_CREATOR_SOURCE_DESCRIPTIONS = new Set([
  'Create or update a Cindy Skill',
  'Create or update a skill',
  'Create or update a Cindy Skill with appropriately scoped instructions and any needed supporting resources.',
]);

export const SKILL_CREATOR_DESCRIPTION_KEY = 'skillhub.builtIn.skillCreator.description' as const;

/**
 * Built-in Skills keep their canonical metadata in English for agents. Cindy
 * substitutes localized copy only when it renders a known built-in entry.
 */
export function builtInSkillDescriptionKey(
  skill: {
    builtIn?: boolean;
    name: string;
    description?: string;
    scope?: string;
  },
): typeof SKILL_CREATOR_DESCRIPTION_KEY | undefined {
  if (skill.name !== SKILL_CREATOR_NAME) return undefined;
  if (skill.builtIn === true || skill.scope === 'system') {
    return SKILL_CREATOR_DESCRIPTION_KEY;
  }
  return skill.description && SKILL_CREATOR_SOURCE_DESCRIPTIONS.has(skill.description.trim())
    ? SKILL_CREATOR_DESCRIPTION_KEY
    : undefined;
}
