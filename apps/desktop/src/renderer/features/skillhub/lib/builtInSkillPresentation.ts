import {
  CINDY_LEARN_NAME,
  CINDY_SKILL_CREATOR_NAME,
  isCindyBuiltInSkillMetadata,
} from '../../../../shared/cindyBuiltInSkills';

export const SKILL_CREATOR_DESCRIPTION_KEY = 'skillhub.builtIn.skillCreator.description' as const;
export const LEARN_DESCRIPTION_KEY = 'skillhub.builtIn.learn.description' as const;

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
): typeof SKILL_CREATOR_DESCRIPTION_KEY | typeof LEARN_DESCRIPTION_KEY | undefined {
  if (!isCindyBuiltInSkillMetadata(skill)) return undefined;
  if (skill.name === CINDY_SKILL_CREATOR_NAME) return SKILL_CREATOR_DESCRIPTION_KEY;
  if (skill.name === CINDY_LEARN_NAME) return LEARN_DESCRIPTION_KEY;
  return undefined;
}

/** Keep SkillHub's Learn shortcut aligned with the built-in Skill toggle. */
export function isBuiltInLearnSkillEnabled(
  skills: ReadonlyArray<{
    builtIn?: boolean;
    cindyEnabled?: boolean;
    name: string;
    description?: string;
    scope?: string;
  }>,
  bootstrapped: boolean,
): boolean {
  return !bootstrapped || skills.some(
    (skill) =>
      skill.name === CINDY_LEARN_NAME
      && isCindyBuiltInSkillMetadata(skill)
      && skill.cindyEnabled !== false,
  );
}
