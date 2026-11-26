#!/usr/bin/env node
// 18번 1단계(상품 화면 나누기) 검증 근거를 output/bundle18-split-check/ 에 남긴다.
//   1) 나누기 전 원본 한 파일 ↔ 나눈 파일들을 git diff --color-moved 로 비교해 '옮겨지지 않은 추가·삭제 줄'만 뽑는다.
//   2) 화면 글자(한글이 든 문자열·JSX 글) 집합이 같은지 본다.
//   3) 호출 목록(fetch·uploadToSignedUrl·router.*)이 저장된 기준(tests/fixtures)과 같은지 본다.
// 쓰는 법: node scripts/check-product-admin-moved.mjs [기준 커밋, 기본 77b7511]
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCallInventory } from './product-admin-call-inventory.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCTS = 'src/app/(admin)/admin/market/products'
const base = process.argv[2] || '77b7511'
const outDir = join(ROOT, 'output/bundle18-split-check')
const { PRODUCT_ADMIN_FILES } = await import('../tests/helpers/product-admin-sources.mjs')

rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, 'before'), { recursive: true })
mkdirSync(join(outDir, 'after'), { recursive: true })

const original = execFileSync('git', ['show', `${base}:${PRODUCTS}/market-products-client.tsx`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 })
writeFileSync(join(outDir, 'before/market-products-client.tsx'), original)
const splitFiles = PRODUCT_ADMIN_FILES.map((path) => ({ path, text: readFileSync(join(ROOT, PRODUCTS, path), 'utf8') }))
for (const { path, text } of splitFiles) {
  mkdirSync(dirname(join(outDir, 'after', path)), { recursive: true })
  writeFileSync(join(outDir, 'after', path), text)
}

// 1) 옮겨지지 않은 줄: 색을 고정해(옮긴 줄은 굵은 자홍·청록, 새로·지운 줄은 초록·빨강) 초록·빨강 줄만 남긴다.
const diff = spawnSync('git', [
  '-c', 'color.diff.new=green', '-c', 'color.diff.old=red',
  '-c', 'color.diff.newMoved=cyan bold', '-c', 'color.diff.oldMoved=magenta bold',
  '-c', 'color.diff.newMovedAlternative=yellow bold', '-c', 'color.diff.oldMovedAlternative=blue bold',
  'diff', '--no-index', '--color=always', '--color-moved=zebra', '--color-moved-ws=allow-indentation-change',
  'before', 'after',
], { cwd: outDir, encoding: 'utf8', maxBuffer: 1e8 })
const GREEN = '\u001b[32m'
const RED = '\u001b[31m'
const notMoved = []
let oldFile = ''
let newFile = ''
for (const rawLine of diff.stdout.split('\n')) {
  const plain = rawLine.replace(/\u001b\[[0-9;]*m/g, '')
  if (plain.startsWith('+++ ')) {
    newFile = plain.slice(4)
    continue
  }
  if (plain.startsWith('--- ')) {
    oldFile = plain.slice(4)
    continue
  }
  if (plain.startsWith('diff --git') || plain.startsWith('@@')) continue
  if (rawLine.startsWith(GREEN) && plain.startsWith('+')) notMoved.push({ file: newFile, sign: '+', line: plain.slice(1) })
  if (rawLine.startsWith(RED) && plain.startsWith('-')) notMoved.push({ file: oldFile, sign: '-', line: plain.slice(1) })
}
// 비교용 사본(.tsx)은 tsc 대상(**/*.tsx)에 잡히지 않게 지운다.
rmSync(join(outDir, 'before'), { recursive: true, force: true })
rmSync(join(outDir, 'after'), { recursive: true, force: true })
writeFileSync(join(outDir, 'not-moved-lines.txt'), notMoved.map((entry) => `${entry.sign} ${entry.file}\t${entry.line}`).join('\n') + '\n')

// 2) 화면 글자: 한글이 든 따옴표 문자열·템플릿·JSX 글(>…<)을 모아 개수까지 비교한다.
function koreanTexts(text) {
  const found = []
  const patterns = [/'([^'\n]*[가-힣][^'\n]*)'/g, /"([^"\n]*[가-힣][^"\n]*)"/g, /`([^`\n]*[가-힣][^`\n]*)`/g, />([^<>{}\n]*[가-힣][^<>{}\n]*)</g]
  const withoutComments = text.replace(/\/\/[^\n]*/g, '').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) found.push(match[1].replace(/\s+/g, ' ').trim())
  }
  return found
}
function countBy(list) {
  const counts = new Map()
  for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}
const beforeTexts = countBy(koreanTexts(original))
const afterTexts = countBy(splitFiles.flatMap(({ text }) => koreanTexts(text)))
const textDiff = []
for (const key of new Set([...beforeTexts.keys(), ...afterTexts.keys()])) {
  if ((beforeTexts.get(key) ?? 0) !== (afterTexts.get(key) ?? 0)) textDiff.push({ text: key, before: beforeTexts.get(key) ?? 0, after: afterTexts.get(key) ?? 0 })
}

// 3) 호출 목록
const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/product-admin-call-inventory.json'), 'utf8'))
const inventory = buildCallInventory(splitFiles)
const inventorySame = JSON.stringify(inventory.calls) === JSON.stringify(fixture.calls)
writeFileSync(join(outDir, 'call-inventory.json'), JSON.stringify(inventory, null, 2) + '\n')

const shellLines = splitFiles[0].text.split('\n').length
const summary = {
  base,
  files: PRODUCT_ADMIN_FILES.length,
  notMovedAdded: notMoved.filter((entry) => entry.sign === '+').length,
  notMovedRemoved: notMoved.filter((entry) => entry.sign === '-').length,
  koreanTextDiff: textDiff,
  callCounts: inventory.counts,
  callInventorySameAsFixture: inventorySame,
  shellLines,
  shellOver700: shellLines > 700,
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
if (!inventorySame || textDiff.length > 0) process.exitCode = 1
