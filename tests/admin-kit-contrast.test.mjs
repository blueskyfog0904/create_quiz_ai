import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// 20번 5-1·9절: tone 토큰 대비(값을 studio-tokens.css 에서 읽어 계산). 모두 4.5:1 이상.
const css = readFileSync(new URL('../src/styles/studio-tokens.css', import.meta.url), 'utf8')
const TONES = ['neutral', 'info', 'success', 'warning', 'danger']

function token(name) {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`))
  assert.ok(match, `--${name} 는 #rrggbb 값이어야 함`)
  return match[1]
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

test('각 tone 의 text 는 자기 soft 바탕과 흰 바탕 모두 4.5:1 이상', () => {
  for (const tone of TONES) {
    const text = token(`admin-tone-${tone}-text`)
    for (const [name, background] of [['soft', token(`admin-tone-${tone}-soft`)], ['white', '#ffffff']]) {
      const ratio = contrast(text, background)
      assert.ok(ratio >= 4.5, `${tone} text 대 ${name}: ${ratio.toFixed(2)}:1`)
    }
    token(`admin-tone-${tone}-border`)
  }
})

test('위험 확정 버튼: 흰 글자 대 --admin-tone-danger-solid(·hover) 4.5:1 이상', () => {
  for (const name of ['admin-tone-danger-solid', 'admin-tone-danger-solid-hover']) {
    const ratio = contrast('#ffffff', token(name))
    assert.ok(ratio >= 4.5, `#fff 대 ${name}: ${ratio.toFixed(2)}:1`)
  }
})

test('사이드바(7단계): 활성 메뉴 흰 글자 대 --studio-primary, 보라 강조 글자 대 어두운 바탕 4.5:1 이상', () => {
  assert.ok(contrast('#ffffff', token('studio-primary')) >= 4.5)
  assert.ok(contrast('#ffffff', token('studio-primary-hover')) >= 4.5)
  // 사이드바 바탕 Tailwind slate-900 ≈ #0f172a
  const ratio = contrast(token('admin-sidebar-accent-text'), '#0f172a')
  assert.ok(ratio >= 4.5, `--admin-sidebar-accent-text 대 slate-900: ${ratio.toFixed(2)}:1`)
})

test('사이드바(7단계 검증 반영): 이름 입력칸 초점 테두리(--admin-sidebar-accent-text) 대 slate-900 3:1 이상', () => {
  const sidebar = readFileSync(new URL('../src/components/layout/admin-sidebar-client.tsx', import.meta.url), 'utf8')
  assert.match(sidebar, /ring-1 ring-slate-600 focus:ring-\[var\(--admin-sidebar-accent-text\)\]/)
  const ratio = contrast(token('admin-sidebar-accent-text'), '#0f172a')
  assert.ok(ratio >= 3, `사이드바 초점 테두리 대 slate-900: ${ratio.toFixed(2)}:1`)
})
