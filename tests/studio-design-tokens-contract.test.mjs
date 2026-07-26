import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const tokenUrl = new URL('../src/styles/studio-tokens.css', import.meta.url)
const globals = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function extractCssRule(source, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const selectorMatch = source.match(
    new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{`)
  )
  assert.ok(selectorMatch, `${selector} rule must exist`)

  const openIndex = source.indexOf('{', selectorMatch.index)
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(openIndex + 1, index)
  }

  assert.fail(`${selector} rule must have a closing brace`)
}

function extractCustomProperty(rule, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const declaration = rule.match(
    new RegExp(`--${escapedName}\\s*:\\s*([^;]+);`, 'i')
  )
  assert.ok(declaration, `--${name} declaration must exist`)
  return declaration[1].trim()
}

function parseHexColor(value) {
  const match = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)
  assert.ok(match, `${value} must be a 3 or 6 digit hex color`)
  const hex = match[1].length === 3
    ? [...match[1]].map((channel) => channel.repeat(2)).join('')
    : match[1]
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
}

function parsePrimaryTransparency(value) {
  const match = value.match(
    /^color-mix\(\s*in\s+srgb\s*,\s*var\(\s*--studio-primary\s*\)\s+([\d.]+)%\s*,\s*transparent\s*\)$/i
  )
  assert.ok(match, '--studio-focus-ring must mix --studio-primary with transparent in srgb')
  const opacity = Number.parseFloat(match[1]) / 100
  assert.ok(opacity >= 0 && opacity <= 1, 'focus-ring primary percentage must be between 0% and 100%')
  return opacity
}

function composite(foreground, background, opacity) {
  return foreground.map((channel, index) => (
    channel * opacity + background[index] * (1 - opacity)
  ))
}

function relativeLuminance(color) {
  const linear = color.map((channel) => {
    const srgb = channel / 255
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

test('studio tokens are centralized without replacing legacy global primary', () => {
  assert.equal(existsSync(tokenUrl), true, 'src/styles/studio-tokens.css must exist')

  const tokens = stripCssComments(readFileSync(tokenUrl, 'utf8'))
  const rootRule = extractCssRule(tokens, ':root')
  for (const name of [
    'background',
    'surface',
    'ink',
    'text',
    'muted',
    'border',
    'control-border',
    'primary',
    'primary-hover',
    'primary-soft',
    'success',
    'highlight',
    'content-width',
    'radius-control',
    'radius-card',
    'shadow-card',
    'font-sans',
    'focus-ring',
  ]) {
    assert.match(rootRule, new RegExp(`--studio-${name}\\s*:`))
  }
  const primary = parseHexColor(extractCustomProperty(rootRule, 'studio-primary'))
  const focusOpacity = parsePrimaryTransparency(
    extractCustomProperty(rootRule, 'studio-focus-ring')
  )
  const focusBackgrounds = [
    ['white', parseHexColor('#fff')],
    ['studio background', parseHexColor(extractCustomProperty(rootRule, 'studio-background'))],
  ]
  for (const [name, background] of focusBackgrounds) {
    const ratio = contrastRatio(composite(primary, background, focusOpacity), background)
    assert.ok(ratio >= 3, `focus ring contrast against ${name} must be at least 3:1, received ${ratio.toFixed(2)}:1`)
  }

  const controlBorder = parseHexColor(
    extractCustomProperty(rootRule, 'studio-control-border')
  )
  const controlBackgrounds = [
    ['white', parseHexColor('#fff')],
    [
      'studio background',
      parseHexColor(extractCustomProperty(rootRule, 'studio-background')),
    ],
  ]
  for (const [name, background] of controlBackgrounds) {
    const ratio = contrastRatio(controlBorder, background)
    assert.ok(
      ratio >= 3,
      `control border contrast against ${name} must be at least 3:1, received ${ratio.toFixed(2)}:1`
    )
  }

  const baseLayerRule = extractCssRule(tokens, '@layer base')
  const studioThemeRule = extractCssRule(baseLayerRule, '.studio-theme')
  assert.match(studioThemeRule, /min-height\s*:\s*100%\s*;/)
  assert.match(studioThemeRule, /background-color\s*:\s*var\(--studio-background\)\s*;/)
  assert.match(studioThemeRule, /color\s*:\s*var\(--studio-text\)\s*;/)
  assert.match(studioThemeRule, /font-family\s*:\s*var\(--studio-font-sans\)\s*;/)

  const uncommentedGlobals = stripCssComments(globals)
  const globalRootRule = extractCssRule(uncommentedGlobals, ':root')
  assert.match(
    uncommentedGlobals,
    /@import ['"]\.\.\/styles\/studio-tokens\.css['"];/
  )
  assert.match(globalRootRule, /--primary\s*:\s*#0A192F\s*;/i)
})

test('the reference gutter variant owns the 20px, 32px, and zero desktop shell padding', () => {
  const tokens = stripCssComments(readFileSync(tokenUrl, 'utf8'))

  assert.match(
    tokens,
    /\.studio-reference-gutter\s+\[data-slot=["']studio-container["']\]\s*\{[^}]*padding-inline\s*:\s*1\.25rem\s*;/s
  )
  assert.match(
    tokens,
    /@media\s*\(\s*min-width\s*:\s*744px\s*\)\s*\{[\s\S]*?\.studio-reference-gutter\s+\[data-slot=["']studio-container["']\]\s*\{[^}]*padding-inline\s*:\s*2rem\s*;/s
  )
  assert.match(
    tokens,
    /@media\s*\(\s*min-width\s*:\s*1200px\s*\)\s*\{[\s\S]*?\.studio-reference-gutter\s+\[data-slot=["']studio-container["']\]\s*\{[^}]*padding-inline\s*:\s*0\s*;/s
  )
})
