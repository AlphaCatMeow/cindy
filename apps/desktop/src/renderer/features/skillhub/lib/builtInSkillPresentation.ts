import { isCindyBuiltInSkillMetadata } from '../../../../shared/cindyBuiltInSkills';

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
  return isCindyBuiltInSkillMetadata(skill) ? SKILL_CREATOR_DESCRIPTION_KEY : undefined;
}
