import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, existsSync } from 'node:fs'

const landingShared = readFileSync(
  new URL('../src/components/features/landing/landing-view-shared.tsx', import.meta.url),
  'utf8'
)
const globalsCss = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')
const buttonSource = readFileSync(new URL('../src/components/ui/button.tsx', import.meta.url), 'utf8')
const workspaceThemeUrl = new URL('../src/lib/workspace-theme.ts', import.meta.url)

test('workspace landing themes use subject-specific blue and green hero palettes', () => {
  assert.match(landingShared, /heroGradient: 'from-blue-700 via-blue-600 to-sky-600'/)
  assert.match(landingShared, /heroGlow: 'bg-blue-500\/30'/)
  assert.match(landingShared, /cardAccentClass: 'from-blue-500\/10 via-sky-400\/5 to-cyan-400\/10'/)
  assert.match(landingShared, /sectionTintClass: 'from-blue-500\/5 via-transparent to-sky-500\/5'/)

  assert.match(landingShared, /heroGradient: 'from-emerald-700 via-teal-600 to-cyan-600'/)
  assert.match(landingShared, /heroGlow: 'bg-emerald-500\/30'/)
  assert.match(landingShared, /cardAccentClass: 'from-emerald-500\/10 via-teal-400\/5 to-cyan-400\/10'/)
  assert.match(landingShared, /sectionTintClass: 'from-emerald-500\/5 via-transparent to-cyan-500\/5'/)
})

test('subject market theme helper centralizes market hero palettes', () => {
  assert.equal(existsSync(workspaceThemeUrl), true)
  const workspaceTheme = readFileSync(workspaceThemeUrl, 'utf8')

  assert.match(workspaceTheme, /import type \{ WorkspaceSubject \} from '\.\/workspace-subject'/)
  assert.match(workspaceTheme, /marketHeroClass: 'border-blue-200\/60 bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600'/)
  assert.match(workspaceTheme, /marketHeroLabelClass: 'text-sky-100'/)
  assert.match(workspaceTheme, /marketHeroMutedTextClass: 'text-sky-100\/85'/)
  assert.match(workspaceTheme, /marketHeroClass: 'border-emerald-200\/60 bg-gradient-to-br from-emerald-700 via-teal-600 to-cyan-600'/)
  assert.match(workspaceTheme, /marketHeroLabelClass: 'text-emerald-100'/)
  assert.match(workspaceTheme, /marketHeroMutedTextClass: 'text-emerald-100\/85'/)
  assert.match(workspaceTheme, /export function getWorkspaceSubjectTheme\(subject: WorkspaceSubject\)/)
})

test('global primary and default button colors stay unchanged', () => {
  assert.match(globalsCss, /--primary:\s*#0A192F/)
  assert.match(buttonSource, /default:\s*[\"']bg-primary text-primary-foreground hover:bg-primary\/90[\"']/)
})
