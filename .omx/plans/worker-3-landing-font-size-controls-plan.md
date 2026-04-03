# Landing-page font-size controls implementation recommendation

## Scope reviewed
- Admin editor: `src/app/(admin)/admin/landing-pages/landing-pages-client.tsx`
- Config schema/defaults: `src/lib/landing-page.ts`
- Persistence path: `src/lib/landing-page-server.ts`
- Public rendering: `src/components/features/landing/MainLandingView.tsx`, `src/components/features/landing/WorkspaceLandingView.tsx`, `src/components/features/landing/landing-view-shared.tsx`
- Existing tests: `tests/landing-page-config.test.mjs`, `tests/landing-multiline-rendering.test.mjs`, `tests/workspace-landing-layout.test.mjs`

## Feasibility verdict
**Feasible without destabilizing the existing JSON/settings model** if font-size state is added as a **separate optional typography subtree** and the renderer maps it through a fixed class lookup.

**Do not use** arbitrary pixel values, free-form Tailwind classes, or wrap every string field into `{ text, fontSize }` objects. Those would either weaken validation or force a high-risk migration of already-stored JSON.

## Recommended data model
Add an optional `typography` object to both landing configs. Keep all existing text fields unchanged.

### Why this is the safest model
1. `normalizeMainLandingConfig` / `normalizeWorkspaceLandingConfig` can keep old saved JSON valid by filling missing typography with defaults.
2. Text content stays in the same shape, so current admin inputs and persisted rows stay compatible.
3. Typography stays attached to the same semantic container, which is safer than a flat field-id map for repeatable arrays like `features`, `steps`, and highlight chips.
4. A bounded numeric step works naturally with +/- controls.

### Recommended type shape
Use a bounded integer step instead of raw pixels:
- `type LandingFontStep = -2 | -1 | 0 | 1 | 2`
- zod schema: `z.number().int().min(-2).max(2)`

Recommended additions in `src/lib/landing-page.ts`:

- `hero.badgeStep`, `hero.titleStep`, `hero.descriptionStep`, `hero.chipSteps: [-2..2, -2..2, -2..2]`
- `workspaceCards[].labelStep`, `titleStep`, `descriptionStep`, `buttonLabelStep`, `highlightChipSteps: LandingFontStep[]`
- `valueSection.headingStep`, `introStep`
- `valuePoints[].titleStep`, `descriptionStep`
- Workspace landing equivalents:
  - singleton fields: `eyebrowStep`, `titleStep`, `descriptionStep`, `heroSummaryStep`, `featureHeadingStep`, `featureIntroStep`, `workflowBadgeStep`, `workflowHeadingStep`, `workflowIntroStep`, `ctaHeadlineStep`, `ctaBodyStep`, `ctaHintStep`
  - arrays: `quickPillSteps`, `features[].titleStep`, `features[].descriptionStep`, `steps[].titleStep`, `steps[].descriptionStep`

### Alternative rejected
**Flat page-level map** like `{ "hero.title": 1 }` is acceptable for fixed fields, but is weaker for mutable arrays because removing `features[1]` or `steps[1]` makes index-based keys drift.

## Rendering strategy
Create a dedicated typography helper, preferably a new file such as:
- `src/lib/landing-page-typography.ts`

That helper should:
1. Define stable slot kinds (`heroBadge`, `heroTitle`, `heroBody`, `chip`, `cardLabel`, `cardTitle`, `cardBody`, `sectionTitle`, `sectionBody`, `itemTitle`, `itemBody`, `ctaTitle`, `ctaBody`, etc.).
2. Map each slot kind + step (`-2..2`) to an explicit Tailwind class string.
3. Return only allowlisted classes; never concatenate free-form class names from JSON.

Example shape:

```ts
export type LandingTypographySlot = 'heroTitle' | 'heroBody' | 'chip' | 'cardTitle' | 'itemBody'

const SLOT_CLASS_MAP: Record<LandingTypographySlot, Record<LandingFontStep, string>> = {
  heroTitle: {
    '-2': 'text-2xl md:text-4xl',
    '-1': 'text-3xl md:text-5xl',
    '0': 'text-4xl md:text-6xl',
    '1': 'text-5xl md:text-7xl',
    '2': 'text-6xl md:text-8xl',
  },
  // ...
}
```

Then replace hard-coded text-size classes in:
- `src/components/features/landing/MainLandingView.tsx`
- `src/components/features/landing/WorkspaceLandingView.tsx`

with `cn(baseSpacingClasses, getLandingTypographyClass(slot, step))`.

## Admin UI recommendation
Add one reusable compact control in `src/app/(admin)/admin/landing-pages/landing-pages-client.tsx`, for example `FontStepControl`.

### Control behavior
- Layout: small `-` button, current state label (`기본`, `+1`, `-1`, etc.), `+` button.
- Clamp to `-2..2`.
- Place the control directly next to each field label or aligned on the right edge of each field row.
- Do not expose a free text input for font size.

### Where to apply it
Apply the control to every admin-editable text slot already exposed in the page:
- main hero badge/title/description/chips
- main workspace card label/title/description/button label/highlight chips
- main value section heading/intro
- main value point title/description
- workspace eyebrow/title/description/hero summary/quick pills
- workspace feature heading/intro + each feature title/description
- workspace workflow badge/heading/intro + each step title/description
- workspace CTA headline/body/hint

### Important implementation detail for arrays
Whenever the UI adds/removes items from:
- `highlightChips`
- `quickPills`
- `features`
- `steps`

update the matching typography arrays/objects in the same state transaction so step metadata never drifts from its text item.

## Public rendering notes
Current text sizes are hard-coded in the views, for example:
- main hero title/body/chips and card text in `src/components/features/landing/MainLandingView.tsx`
- workspace hero, quick-entry card, feature cards, workflow cards, and CTA in `src/components/features/landing/WorkspaceLandingView.tsx`

The implementation should preserve:
- current line-break behavior (`whitespace-pre-line`)
- current layout grids and spacing
- current badge/icon/theme behavior

Font controls should change **type scale only**, not spacing, margins, icon sizes, or card layout rules.

## Suggested implementation slices
1. **Schema/defaults/normalization**
   - File: `src/lib/landing-page.ts`
   - Add typography schemas, defaults, normalize/validate support.
2. **Admin editor controls**
   - File: `src/app/(admin)/admin/landing-pages/landing-pages-client.tsx`
   - Add reusable +/- control and wire every editable slot.
3. **Renderer helper**
   - File: `src/lib/landing-page-typography.ts` (new)
   - Centralize slot-to-class lookup.
4. **Main landing rendering**
   - File: `src/components/features/landing/MainLandingView.tsx`
5. **Workspace landing rendering**
   - File: `src/components/features/landing/WorkspaceLandingView.tsx`
6. **Regression tests**
   - Files: `tests/landing-page-config.test.mjs`, `tests/landing-multiline-rendering.test.mjs`, plus a new typography-focused test file.

## Test plan
### Must-add automated checks
1. **Schema normalization backward-compatibility**
   - Old saved JSON without `typography` still normalizes to defaults.
2. **Validation bounds**
   - `-3` / `3` rejected.
3. **Array sync behavior**
   - Adding/removing feature/step/chip items preserves aligned typography metadata.
4. **Renderer class mapping**
   - Step `0` matches current baseline classes.
   - `-1` / `+1` return only allowlisted classes.
5. **Multiline regression**
   - Existing `whitespace-pre-line` coverage remains intact.
6. **Layout regression**
   - Existing 3-card/4-card workspace layout tests still pass.

### Suggested test files
- Update `tests/landing-page-config.test.mjs`
- Update `tests/landing-multiline-rendering.test.mjs`
- Add `tests/landing-page-typography.test.mjs`

## Risks and mitigations
1. **Risk: schema bloat / repetitive code**
   - Mitigation: keep typography in a dedicated subtree, not mixed into text content.
2. **Risk: array metadata drift after add/remove**
   - Mitigation: update text + typography together in one setter.
3. **Risk: oversized text breaking cards on small screens**
   - Mitigation: cap to `-2..2`, tune per-slot class maps separately, and keep responsive mappings explicit.
4. **Risk: Tailwind purge misses dynamic classes**
   - Mitigation: store full class strings in source code lookup tables, not computed fragments.
5. **Risk: duplication across main/workspace renderers**
   - Mitigation: centralize slot mapping in one helper.

## Concrete recommendation for the leader
Implement this as a **bounded typography-step system with an optional mirrored `typography` subtree**, not as free-form font values and not as wrapped text objects. That is the best fit for the current Zod-validated JSON config, the current array-heavy admin editor, and the current Tailwind-based public rendering.
