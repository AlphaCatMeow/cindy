import { describe, expect, it } from 'vitest';

import { CINDY_LEARN_SOURCE_DESCRIPTION } from '../../../../../shared/cindyBuiltInSkills';
import { isBuiltInLearnSkillEnabled } from '../builtInSkillPresentation';

describe('isBuiltInLearnSkillEnabled', () => {
  it('waits for the local scan, then follows only the official Learn entry', () => {
    expect(isBuiltInLearnSkillEnabled([], false)).toBe(true);
    expect(isBuiltInLearnSkillEnabled([], true)).toBe(false);
    expect(isBuiltInLearnSkillEnabled([{
      name: 'learn',
      description: 'My own Learn workflow',
      scope: 'global',
      cindyEnabled: true,
    }], true)).toBe(false);
    expect(isBuiltInLearnSkillEnabled([{
      name: 'learn',
      description: CINDY_LEARN_SOURCE_DESCRIPTION,
      scope: 'global',
      cindyEnabled: false,
    }], true)).toBe(false);
    expect(isBuiltInLearnSkillEnabled([{
      name: 'learn',
      description: CINDY_LEARN_SOURCE_DESCRIPTION,
      scope: 'global',
      cindyEnabled: true,
    }], true)).toBe(true);
  });
});
