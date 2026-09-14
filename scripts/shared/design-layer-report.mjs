import { readFileSync } from 'node:fs';

// Read the generation contract, not a second hand-maintained token allowlist.
// Exported so the audit can validate the binding on every invocation, not
// only when a spacing candidate reaches the lazy read below.
let spacingVariables;
export function getSpacingVariables() {
  if (!spacingVariables) {
    const { foundations } = JSON.parse(readFileSync(new URL('../../packages/design-tokens/src/desktop-bindings.json', import.meta.url), 'utf8'));
    if (!foundations?.css || typeof foundations.css !== 'object') {
      throw new Error('Invalid desktop-bindings.json; expected foundations.css spacing bindings');
    }
    spacingVariables = new Set(Object.entries(foundations.css)
      // Includes component spacing (space-input-lg), not only Tailwind's scale.
      .filter(([, id]) => id.startsWith('semantic.foundations.space-'))
      .map(([name]) => `--${name}`));
  }
  return spacingVariables;
}

function classifySpacing(value) {
  const spacingVariables = getSpacingVariables();
  const expression = value.slice(value.indexOf('[') + 1, -1);
  const direct = /^var\(\s*(--[\w-]+)\s*\)$/.exec(expression);
  if (direct && spacingVariables.has(direct[1])) {
    return { classification: 'spacing-source-reference',
      reason: 'References the generated spacing source; component-role suitability still needs review.' };
  }
  const references = [...expression.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]);
  if (references.some(name => !spacingVariables.has(name))) {
    return { classification: 'unknown-spacing-reference',
      reason: 'Contains a variable outside the generated spacing bindings; verify its source, fallbacks and component role. A variable name alone is not approval.' };
  }
  if (references.length) {
    const mixed = /\d/.test(expression.replace(/--[\w-]+/g, ''));
    return { classification: mixed ? 'mixed-spacing-expression' : 'spacing-expression',
      reason: mixed ? 'Combines spacing references with literal values (including fallbacks); review each literal and the component role.'
        : 'Derived spacing expression; verify the calculation and component role. References do not approve the whole expression.' };
  }
  return { classification: /^-?(?:\d*\.)?\d+(?:px|rem|em|%|vh|vw)?$/.test(expression) ? 'literal-spacing' : 'unclassified-spacing',
    reason: 'No verified spacing source reference; use the matching standard spacing class or document the component-specific geometry.' };
}

/** Report-only layer review. Registrations live in DESIGN §5, not this module.
 * Recognise only explicit production identities; unknown membership never becomes
 * a pill recommendation. This deliberately cannot adjudicate visual evidence. */
export function classifyDesignLayer({ member, layer, radius, evidence = false }) {
  if (layer === 'hit') return { classification: 'pending-target', reason: 'Hit geometry is independent of the visible mark; usage date targets still await the designer ruling.' };
  if (layer === 'indicator') return { classification: 'interaction-indicator', reason: 'Focus/selection is a separate layer; review the registered component treatment.' };
  const expected = { keycap: '4px', 'usage-heatmap-day': '2px', 'usage-token-bar': '2px',
    'workflow-status-cell': '2px', 'system-category-square': '2px',
    'ordinary-action': 'full', container: 'xl', textarea: 'lg' }[member];
  if (!expected) return { classification: 'unknown', reason: 'Visible layer has no verified registration/classification; DESIGN §5 requires a decision, not a pill guess.' };
  if (!evidence) return { classification: 'missing-evidence', reason: `Claimed ${member} needs evidence identifying this particular visible layer and scope.` };
  const equivalents = { full: ['full', '9999px'], xl: ['xl', '12px'], lg: ['lg', '8px'] };
  return (equivalents[expected] ?? [expected]).includes(radius)
    ? { classification: 'registered-value', reason: `${member}: matches DESIGN §5 on this visible layer; not a whole-component approval.` }
    : { classification: 'registered-value-violation', reason: `${member}: this visible layer requires ${expected} at all four corners (DESIGN §5).` };
}

export function reportDesignLayers(file, source, changed, locate) {
  const findings = [];
  const patterns = /\brounded(?:-(?:\[[^\]\n]+\]|[\w-]+))?|\bborder(?:-radius|Radius)\s*:\s*[^;,}\n]+|\b(?:p[xytrblse]?|gap(?:-[xy])?)-\[[^\]\n]+\]/g;
  for (const match of source.matchAll(patterns)) {
    const pos = locate(match.index);
    if (!changed.has(pos.line)) continue;
    const tagStart = source.lastIndexOf('<', match.index);
    const tagEnd = source.indexOf('>', match.index);
    const tag = tagStart >= 0 && tagEnd >= 0 ? source.slice(tagStart, tagEnd + 1) : '';
    const isRadius = /^(rounded|border)/.test(match[0]);
    let member, layer, evidence = false;
    if (/\/usage\/Usage(?:Heatmap|TokenBars)\.tsx$|\/UsageHeatmap\.tsx$/.test(file)) {
      member = /data-usage-mark="(usage-heatmap-day|usage-token-bar)"/.exec(tag)?.[1];
      if (member) evidence = true;
      else if (/\busage-chart-target\b/.test(tag)) layer = 'hit';
      else if (/\busage-chart-indicator\b/.test(tag)) layer = 'indicator';
    }
    // Registered keyboard frame AND visible fill/border, not a button-tag heuristic.
    if (/^<kbd\s/.test(tag) && /\b(?:border|bg-)/.test(tag)) { member = 'keycap'; evidence = true; }
    const radius = /^rounded-\[([^\]]+)\]$/.exec(match[0])?.[1] ?? match[0].replace(/^rounded-/, '');
    const judgement = isRadius ? classifyDesignLayer({ member, layer, radius, evidence })
      : classifySpacing(match[0]);
    findings.push({ file, ...pos, rule: isRadius ? 'visible-layer-radius' : 'role-spacing',
      value: match[0], disposition: 'report', ...judgement,
      suggestion: isRadius
        ? 'Review the visible frame, contained mark and hit/indicator layers separately against DESIGN §5 and governance §13; register missing evidence/decisions. Do not change user radius overrides.'
        : 'Use the existing p/px/py/gap/gap-x/gap-y scale from desktop-bindings.json foundations.spacing and the component treatment in DESIGN §4/5. Verify unknown variables, calculations and fallbacks; do not infer button padding from a DOM tag.' });
  }
  if (/components\/settings\/.*(?:Dialog|Wizard)\.tsx$/.test(file) && changed.size) {
    findings.push({ file, line: Math.min(...changed), column: 1, rule: 'form-adoption', disposition: 'report',
      value: 'form consumer', reason: 'G2 independent contributor trial is pending; broad FormField adoption is not a blocking rule.',
      suggestion: 'Use DESIGN §4 and the existing DS-6 behaviour tests to review field association, focus, saving and secret controls. Do not infer behaviour from classes.' });
  }
  return findings;
}
