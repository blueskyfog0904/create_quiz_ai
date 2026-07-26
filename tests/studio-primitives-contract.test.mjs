import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const buttonSource = readFileSync(
  new URL('../src/components/ui/button.tsx', import.meta.url),
  'utf8'
)
const portalUrl = new URL(
  '../src/components/design-system/studio-portal-surface.tsx',
  import.meta.url
)

const legacyVariants = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive:
    'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
  outline:
    'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
  link: 'text-primary underline-offset-4 hover:underline',
}

const brandVariants = {
  brand:
    'min-h-11 min-w-11 bg-[var(--studio-primary)] text-white hover:bg-[var(--studio-primary-hover)] focus-visible:ring-[var(--studio-focus-ring)]',
  brandOutline:
    'min-h-11 min-w-11 border border-[var(--studio-control-border)] bg-[var(--studio-surface)] text-[var(--studio-text)] hover:border-[var(--studio-primary)] hover:text-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]',
  brandGhost:
    'min-h-11 min-w-11 text-[var(--studio-text)] hover:bg-[var(--studio-primary-soft)] hover:text-[var(--studio-primary)] focus-visible:ring-[var(--studio-focus-ring)]',
}

function extractVariantClasses(source) {
  const variantBlock = source.match(
    /variant:\s*\{([\s\S]*?)\n\s*\},\n\s*size:\s*\{/
  )
  assert.ok(
    variantBlock,
    'button variant block must remain readable by the contract'
  )

  const entries = {}
  const entryPattern = /^\s*(\w+):\s*(?:\n\s*)?["']([^"']*)["'],?$/gm
  for (const match of variantBlock[1].matchAll(entryPattern)) {
    entries[match[1]] = match[2]
  }
  return entries
}

function extractDefaultVariants(source) {
  const defaults = source.match(
    /defaultVariants:\s*\{\s*variant:\s*["']([^"']+)["'],\s*size:\s*["']([^"']+)["'],\s*\}/
  )
  assert.ok(
    defaults,
    'button defaultVariants must remain readable by the contract'
  )
  return { variant: defaults[1], size: defaults[2] }
}

function extractStringConstant(source, name) {
  const declaration = source.match(
    new RegExp(`export\\s+const\\s+${name}\\s*=\\s*(['\"\\\`])([\\s\\S]*?)\\1`)
  )
  assert.ok(declaration, `${name} must be exported as a string constant`)
  return declaration[2]
}

function assertNamedFunctionExport(source, name) {
  const directExport = new RegExp(`export\\s+function\\s+${name}\\b`).test(
    source
  )
  const exportList = [...source.matchAll(/export\s*\{([\s\S]*?)\}/g)].some(
    (match) =>
      match[1]
        .split(',')
        .map((entry) => entry.trim())
        .includes(name)
  )

  assert.ok(
    directExport || exportList,
    `${name} must be exported directly or through an explicit export list`
  )
}

function extractFunctionBody(source, name) {
  const declaration = source.match(
    new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`)
  )
  assert.ok(declaration, `${name} must be exported as a function`)

  const parametersOpen = source.indexOf('(', declaration.index)
  let parameterDepth = 0
  let parametersClose = -1
  for (let index = parametersOpen; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1
    if (source[index] === ')') parameterDepth -= 1
    if (parameterDepth === 0) {
      parametersClose = index
      break
    }
  }
  assert.notEqual(parametersClose, -1, `${name} parameters must close`)

  const bodyOpen = source.indexOf('{', parametersClose)
  assert.notEqual(bodyOpen, -1, `${name} body must exist`)
  let bodyDepth = 0
  for (let index = bodyOpen; index < source.length; index += 1) {
    if (source[index] === '{') bodyDepth += 1
    if (source[index] === '}') bodyDepth -= 1
    if (bodyDepth === 0) return source.slice(bodyOpen + 1, index)
  }

  assert.fail(`${name} body must have a closing brace`)
}

function assertWrapperClassComposition({
  source,
  wrapperName,
  renderedComponent,
  requiredClasses,
}) {
  assertNamedFunctionExport(source, wrapperName)
  const body = extractFunctionBody(source, wrapperName)
  const openingTag = body.match(
    new RegExp(`<${renderedComponent}\\b([\\s\\S]*?)>`)
  )
  assert.ok(openingTag, `${wrapperName} must render ${renderedComponent}`)
  assert.match(
    openingTag[1],
    /\{\s*\.\.\.props\s*\}/,
    `${wrapperName} must forward ...props to ${renderedComponent}`
  )

  const classComposition = openingTag[1].match(
    /className\s*=\s*\{\s*cn\(([\s\S]*?)\)\s*\}/
  )
  assert.ok(
    classComposition,
    `${wrapperName} must compose ${renderedComponent} className with cn`
  )
  assert.match(classComposition[1], /\bstudioPortalSurfaceClass\b/)
  assert.match(
    classComposition[1],
    /\bclassName\b/,
    `${wrapperName} must preserve its caller className`
  )
  for (const className of requiredClasses) {
    assert.ok(
      classComposition[1].includes(className),
      `${wrapperName} must compose ${className} on ${renderedComponent}`
    )
  }
}

test('legacy button variant keys, classes, and defaults remain unchanged', () => {
  const variants = extractVariantClasses(buttonSource)

  for (const [key, className] of Object.entries(legacyVariants)) {
    assert.ok(Object.hasOwn(variants, key), `legacy ${key} variant is missing`)
    assert.equal(variants[key], className, `legacy ${key} variant changed`)
  }
  assert.deepEqual(extractDefaultVariants(buttonSource), {
    variant: 'default',
    size: 'default',
  })
})

test('button adds the Studio brand variants without replacing legacy variants', () => {
  const variants = extractVariantClasses(buttonSource)

  for (const [key, className] of Object.entries(brandVariants)) {
    assert.ok(Object.hasOwn(variants, key), `Studio ${key} variant is missing`)
    assert.equal(
      variants[key],
      className,
      `Studio ${key} variant is missing or changed`
    )
  }
})

test('Studio portal wrappers expose semantic aliases and 44px hit areas', () => {
  assert.equal(
    existsSync(portalUrl),
    true,
    'src/components/design-system/studio-portal-surface.tsx must exist'
  )

  const portalSource = readFileSync(portalUrl, 'utf8')
  const portalSurfaceClass = extractStringConstant(
    portalSource,
    'studioPortalSurfaceClass'
  )
  assert.match(
    portalSource,
    /import\s*\{[^}]*\bDialogContent\b[^}]*\}\s*from\s*['"]@\/components\/ui\/dialog['"]/s
  )
  assert.match(
    portalSource,
    /import\s*\{[^}]*\bSelectContent\b[^}]*\}\s*from\s*['"]@\/components\/ui\/select['"]/s
  )

  for (const alias of [
    '[--background:var(--studio-surface)]',
    '[--foreground:var(--studio-text)]',
    '[--popover:var(--studio-surface)]',
    '[--popover-foreground:var(--studio-text)]',
    '[--accent:var(--studio-primary-soft)]',
    '[--accent-foreground:var(--studio-primary)]',
    '[--ring:var(--studio-focus-ring)]',
  ]) {
    assert.ok(
      portalSurfaceClass.includes(alias),
      `portal semantic alias ${alias} is missing from studioPortalSurfaceClass`
    )
  }

  assertWrapperClassComposition({
    source: portalSource,
    wrapperName: 'StudioDialogContent',
    renderedComponent: 'DialogContent',
    requiredClasses: [
      '[&_[data-slot=dialog-close]]:size-11',
      '[&_[data-slot=dialog-header]]:pr-16',
    ],
  })
  assertWrapperClassComposition({
    source: portalSource,
    wrapperName: 'StudioSelectContent',
    renderedComponent: 'SelectContent',
    requiredClasses: [
      '[&_[data-slot=select-item]]:min-h-11',
      '[&_[data-slot=select-item]]:min-w-11',
    ],
  })
})
