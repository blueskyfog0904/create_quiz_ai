# Landing-page font-size controls recommendation

## Verdict

Feasible **without destabilizing the JSON/settings model**.

The current landing-page data already persists as JSON in `system_settings.value` (`main_landing_page`) and workspace settings (`landing_page`), then passes through `zod` normalization in `src/lib/landing-page.ts`. Because the config is schema-validated and defaulted on read, the safest path is an **additive, tokenized `fontSteps` branch** on each config type. This avoids:

- DB schema changes
- mixing style metadata into existing string fields
- storing raw pixel values in settings JSON
- per-render ad hoc inline styles

## Why this is safe in this codebase

Observed structure:

- Admin editor state lives entirely in `src/app/(admin)/admin/landing-pages/landing-pages-client.tsx`
- Public rendering is centralized in:
  - `src/components/features/landing/MainLandingView.tsx`
  - `src/components/features/landing/WorkspaceLandingView.tsx`
- Persistence is already centralized in:
  - `src/lib/landing-page.ts` (schema/default/normalize/validate)
  - `src/lib/landing-page-server.ts` (JSON read/write)

Implication: one additive schema change plus shared render helpers is enough; no migration is required.

## Recommended data model

### 1) Add bounded font-step tokens, not px values

Use small integer steps:

```ts
export const LANDING_FONT_STEPS = [-2, -1, 0, 1, 2] as const
export type LandingFontStep = (typeof LANDING_FONT_STEPS)[number]
```

Why:

- matches the requested simple `+/-` control
- serializes compactly
- easy to clamp
- easy to map to stable Tailwind class tables
- avoids raw `14px` / `22px` values becoming an unbounded styling API

### 2) Add a separate `fontSteps` tree, mirroring only text fields

Do **not** convert text fields into `{ text, fontStep }` objects.
Do **not** add arbitrary `className` / `style` fields to settings.

Recommended shape:

```ts
interface MainLandingConfig {
  hero: { ... }
  workspaceCards: [...]
  valueSection: { ... }
  valuePoints: [...]
  fontSteps: {
    hero: {
      badge: LandingFontStep
      title: LandingFontStep
      description: LandingFontStep
      chips: [LandingFontStep, LandingFontStep, LandingFontStep]
    }
    workspaceCards: [
      {
        label: LandingFontStep
        title: LandingFontStep
        description: LandingFontStep
        buttonLabel: LandingFontStep
        highlightChips: LandingFontStep[]
      },
      {
        label: LandingFontStep
        title: LandingFontStep
        description: LandingFontStep
        buttonLabel: LandingFontStep
        highlightChips: LandingFontStep[]
      }
    ]
    valueSection: {
      heading: LandingFontStep
      intro: LandingFontStep
    }
    valuePoints: Array<{
      title: LandingFontStep
      description: LandingFontStep
    }>
  }
}
```

```ts
interface WorkspaceLandingConfig {
  ...existing text fields...
  fontSteps: {
    eyebrow: LandingFontStep
    title: LandingFontStep
    description: LandingFontStep
    heroSummary: LandingFontStep
    featureHeading: LandingFontStep
    featureIntro: LandingFontStep
    workflowBadge: LandingFontStep
    workflowHeading: LandingFontStep
    workflowIntro: LandingFontStep
    ctaHeadline: LandingFontStep
    ctaBody: LandingFontStep
    ctaHint: LandingFontStep
    quickPills: LandingFontStep[]
    features: Array<{ title: LandingFontStep; description: LandingFontStep }>
    steps: Array<{ title: LandingFontStep; description: LandingFontStep }>
  }
}
```

### 3) Default every new step to `0`

Backward compatibility rule:

- old saved JSON without `fontSteps` normalizes to a fully populated default `fontSteps` tree
- invalid/misaligned arrays fall back to default config for that branch

### 4) Keep array lengths synchronized in one place

Because `quickPills`, `highlightChips`, `features`, and `steps` are editable arrays, every add/remove path in `landing-pages-client.tsx` should update the matching `fontSteps` array at the same time.

This is still safer than a flat key-value map because the schema can validate shape/length expectations.

## Admin UI recommendation

### Reusable control

Add one small reusable control component inside `landing-pages-client.tsx` (or a co-located helper) such as:

- label text
- current step badge (`-2`..`+2` or `작게/기본/크게`)
- minus button
- plus button
- disabled at bounds

Suggested behavior:

- show the control inline with every text-field label
- do not add freeform numeric input
- preview updates immediately in the existing desktop/mobile preview panes
- reset should restore both text defaults and all steps back to `0`

Example UI pattern:

- `Label` on left
- `[-] [기본] [+]` on right
- small helper text optional: `현재: +1`

### Which admin fields get controls

Apply controls to **every editable text slot currently exposed**:

Main landing:
- `hero.badge`
- `hero.title`
- `hero.description`
- `hero.chips[]`
- `workspaceCards[].label`
- `workspaceCards[].title`
- `workspaceCards[].description`
- `workspaceCards[].buttonLabel`
- `workspaceCards[].highlightChips[]`
- `valueSection.heading`
- `valueSection.intro`
- `valuePoints[].title`
- `valuePoints[].description`

Workspace landing:
- `eyebrow`
- `title`
- `description`
- `heroSummary`
- `quickPills[]`
- `featureHeading`
- `featureIntro`
- `features[].title`
- `features[].description`
- `workflowBadge`
- `workflowHeading`
- `workflowIntro`
- `steps[].title`
- `steps[].description`
- `ctaHeadline`
- `ctaBody`
- `ctaHint`

No controls needed for:
- icon selects
- theme selects
- target switcher buttons
- quick-entry labels derived from navigation config

## Public rendering recommendation

### Use semantic slot kinds -> fixed class tables

Do **not** generate Tailwind classes dynamically from numbers.
Instead, map each slot kind plus step to a fixed class string from a constant table.

Recommended helper location:

- `src/components/features/landing/landing-view-shared.tsx`

Suggested API:

```ts
getLandingFontSizeClass(slot: LandingFontSlot, step: LandingFontStep): string
```

Example slot kinds:

```ts
type LandingFontSlot =
  | 'heroBadge'
  | 'heroTitle'
  | 'heroBody'
  | 'chip'
  | 'cardLabel'
  | 'cardTitle'
  | 'cardBody'
  | 'buttonLabel'
  | 'sectionHeading'
  | 'sectionIntro'
  | 'itemTitle'
  | 'itemBody'
  | 'workflowIndex'
  | 'ctaTitle'
  | 'ctaBody'
```

Example class-table pattern:

```ts
const LANDING_FONT_CLASS_MAP = {
  heroTitle: {
    [-2]: 'text-2xl md:text-4xl',
    [-1]: 'text-3xl md:text-5xl',
    [0]: 'text-4xl md:text-6xl',
    [1]: 'text-5xl md:text-7xl',
    [2]: 'text-6xl md:text-8xl',
  },
  heroBody: {
    [-2]: 'text-sm md:text-base',
    [-1]: 'text-base md:text-lg',
    [0]: 'text-lg md:text-xl',
    [1]: 'text-xl md:text-2xl',
    [2]: 'text-2xl md:text-3xl',
  },
}
```

Then update rendered text nodes by appending that class.

This keeps:

- deterministic styling
- Tailwind-safe class discovery
- responsive behavior preserved per slot
- no inline-style drift

### Rendering implementation notes

`MainLandingView.tsx` and `WorkspaceLandingView.tsx` should remain content-first. Only add small helper calls where text is rendered.

Pattern:

```tsx
<h1 className={cn('existing classes', getLandingFontSizeClass('heroTitle', config.fontSteps.hero.title))}>
```

Do not let admin JSON choose arbitrary `font-weight`, `tracking`, `leading`, or colors. Keep this feature scoped to size only.

## Concrete file-level implementation plan

1. `src/lib/landing-page.ts`
   - add `LandingFontStep` constants/schema
   - add `fontSteps` schemas for main/workspace configs
   - populate defaults with zeroes
   - ensure normalize/validate include new branch

2. `src/app/(admin)/admin/landing-pages/landing-pages-client.tsx`
   - add reusable `FontStepControl`
   - wire controls to every text input/textarea/list item
   - update add/remove handlers so text arrays and `fontSteps` arrays stay aligned
   - include font-step reset behavior

3. `src/components/features/landing/landing-view-shared.tsx`
   - add fixed class maps and helper(s)

4. `src/components/features/landing/MainLandingView.tsx`
   - apply slot-based font-size classes for all editable text nodes

5. `src/components/features/landing/WorkspaceLandingView.tsx`
   - apply slot-based font-size classes for all editable text nodes

6. Optional small helper extraction if diff grows:
   - `src/lib/landing-page-font-steps.ts` or shared helper near landing code
   - only if `landing-page.ts` becomes too dense

## Test plan

### Add/extend tests in `tests/`

1. **Schema/default tests** (`tests/landing-page-config.test.mjs`)
   - `normalizeMainLandingConfig` backfills missing `fontSteps`
   - `normalizeWorkspaceLandingConfig` backfills missing `fontSteps`
   - validation rejects out-of-range steps (`-3`, `3`)
   - add/remove array branches preserve matching font-step lengths

2. **Static render wiring tests** (similar to `tests/landing-multiline-rendering.test.mjs`)
   - `MainLandingView.tsx` references font-size helper for title/body/chips/cards/value section
   - `WorkspaceLandingView.tsx` references font-size helper for hero/feature/workflow/cta text
   - admin editor source contains the reusable font-step control next to text labels

3. **Optional pure helper tests**
   - if class mapping helper is extracted, test each slot returns bounded known classes for each step

### Verification commands the implementer should run

- `npx tsc --noEmit`
- `node --test tests/landing-page-config.test.mjs tests/landing-multiline-rendering.test.mjs`
- `npx eslint src/lib/landing-page.ts src/app/'(admin)'/admin/landing-pages/landing-pages-client.tsx src/components/features/landing/MainLandingView.tsx src/components/features/landing/WorkspaceLandingView.tsx src/components/features/landing/landing-view-shared.tsx`

If the implementer adds helper files, include them in the lint command.

## Risks and guardrails

### Main risks

1. **Array desynchronization**
   - risk: removing a feature/chip leaves mismatched `fontSteps`
   - guardrail: update text array and font-step array in the same state setter

2. **Tailwind purge / missing styles**
   - risk: dynamic class name construction drops classes from build output
   - guardrail: use explicit constant class tables only

3. **Oversized layouts on mobile**
   - risk: `+2` on hero/body/card titles can overflow
   - guardrail: keep range small (`-2..2`) and use per-slot responsive tables, not one universal scale

4. **Scope creep into typography design system**
   - risk: request expands into weight/line-height/color controls
   - guardrail: ship size-only controls first

5. **Backward compatibility with saved JSON**
   - risk: older rows lack `fontSteps`
   - guardrail: defaults + normalization solve this without migration

## Recommended final decision

Implement **bounded per-field `fontSteps` with a mirrored config branch and shared slot-to-class resolver**.

This is the most stable option because it:

- keeps existing text content schema intact
- requires no Supabase migration
- preserves predictable rendering
- supports the requested `+/-` admin interaction exactly
- is easy to test with the repo's current `node:test` pattern

## Fastest safe implementation order

1. Add schema/defaults for `fontSteps`
2. Add render helper + apply to public views
3. Add reusable admin `FontStepControl`
4. Wire all fields and array add/remove sync
5. Add/extend tests
6. Run typecheck/tests/lint

