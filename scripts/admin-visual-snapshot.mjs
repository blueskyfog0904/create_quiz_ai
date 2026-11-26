#!/usr/bin/env node
// 관리자 화면 비교(시각 회귀) 개발 전용 스크립트 — 20번 계획 6-3. 저장소에는 스크립트만 두고 사진·로그인 상태는 저장소 밖에 둔다.
//
// 두 번 실행한다.
//   ① 로그인:  node scripts/admin-visual-snapshot.mjs login   [--base http://localhost:4000]
//      막기 없이 브라우저를 띄우고 사람이 직접 로그인만 한다. 관리자 화면에 들어가면 로그인 상태를 저장하고 끝낸다.
//      찍지도, 다른 화면으로 가지도 않는다. 서비스 키·시험용 계정 만들기 스크립트는 쓰지 않는다.
//   ② 찍기:   node scripts/admin-visual-snapshot.mjs capture --label before --paths /admin/review-tags,/admin/my-password
//      로그인 상태를 불러온 뒤 GET·HEAD 가 아닌 요청(서버 액션 POST·토큰 갱신 포함)을 모두 막고, WebSocket 은 서버에 잇지 않고 닫은 채 찍는다.
//      막힌 요청이 하나라도 있거나 로그인 화면으로 넘어가면 실패로 끝난다(그때는 ①부터 다시).
//
// localhost:4000 도 운영 DB 를 쓴다. 이 스크립트는 읽기(GET)만 하고, 브라우저 확인 창은 모두 닫는다(dismiss).
// 회원 개인정보 칸(data-admin-pii)은 회색으로 가린다. 유형 (나) 확인 창(첫 요청이 쓰기)은 찍지 않는다.

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT_ROOT = path.join(homedir(), 'admin-visual-snapshots')
const STORAGE_STATE = path.join(SNAPSHOT_ROOT, '.auth', 'storage-state.json')
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 375, height: 667 },
]
const ALLOWED_METHODS = new Set(['GET', 'HEAD'])
const PII_SELECTOR = '[data-admin-pii]'

function parseArgs(argv) {
  const [mode, ...rest] = argv
  const options = { mode, base: 'http://localhost:4000', label: 'snapshot', paths: [] }
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index]
    const value = rest[index + 1]
    if (key === '--base') options.base = value
    else if (key === '--label') options.label = value
    else if (key === '--paths') options.paths = value.split(',').map((item) => item.trim()).filter(Boolean)
    else throw new Error(`모르는 옵션: ${key}`)
    index += 1
  }
  return options
}

// 사진·로그인 상태가 저장소 안에 생기지 않게 막는다.
function assertOutsideRepo(target) {
  const relative = path.relative(REPO_ROOT, path.resolve(target))
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error(`저장소 안에는 쓰지 않습니다: ${target}`)
  }
}

function isLoginUrl(url) {
  const { pathname } = new URL(url)
  return pathname === '/login' || pathname.startsWith('/admin/login') || pathname.startsWith('/auth/')
}

function todayKst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

function slugOf(pathAndQuery) {
  return pathAndQuery.replace(/^\//, '').replace(/[^a-zA-Z0-9가-힣_-]+/g, '_') || 'root'
}

async function login({ base }) {
  assertOutsideRepo(STORAGE_STATE)
  mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })
  const browser = await chromium.launch({ headless: false })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(new URL('/admin/login', base).toString())
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    await prompt.question('브라우저에서 직접 로그인해 관리자 화면이 보이면 Enter 를 누르세요. ')
    prompt.close()
    if (isLoginUrl(page.url()) || !new URL(page.url()).pathname.startsWith('/admin')) {
      throw new Error(`관리자 화면이 아닙니다(${page.url()}). 로그인을 마친 뒤 다시 실행하세요.`)
    }
    await context.storageState({ path: STORAGE_STATE })
    console.log(`로그인 상태를 저장했습니다: ${STORAGE_STATE}`)
  } finally {
    await browser.close()
  }
}

async function capture({ base, label, paths }) {
  if (paths.length === 0) throw new Error('--paths 로 찍을 주소를 주세요(쉼표로 여러 개, 필터 적용은 ?q= 처럼 주소에).')
  const outputDir = path.join(SNAPSHOT_ROOT, todayKst(), label)
  assertOutsideRepo(outputDir)
  mkdirSync(outputDir, { recursive: true })

  const blocked = []
  const closedSockets = []
  const browser = await chromium.launch()
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ storageState: STORAGE_STATE, viewport })
      // 쓰기 막기: GET·HEAD 가 아닌 요청은 모두 끊는다(서버 액션 Next-Action POST·토큰 갱신 POST 포함).
      await context.route('**/*', async (route) => {
        const request = route.request()
        if (ALLOWED_METHODS.has(request.method())) return route.continue()
        blocked.push(`${request.method()} ${request.url()}`)
        return route.abort('blockedbyclient')
      })
      // route 는 WebSocket 을 잡지 않는다. 실시간 구독(WebSocket)은 서버에 잇지 않고 바로 닫는다(쓰기 경로를 남기지 않음).
      await context.routeWebSocket(/.*/, (socket) => {
        closedSockets.push(socket.url())
        socket.close()
      })
      const page = await context.newPage()
      // 브라우저 확인·알림 창은 모두 닫는다(확정하지 않음).
      page.on('dialog', (dialog) => void dialog.dismiss())

      for (const target of paths) {
        await page.goto(new URL(target, base).toString(), { waitUntil: 'networkidle' })
        if (isLoginUrl(page.url())) {
          throw new Error(`로그인이 풀렸습니다(${target} → ${page.url()}). login 부터 다시 실행하세요.`)
        }
        const file = path.join(outputDir, `${slugOf(target)}_${viewport.width}x${viewport.height}.png`)
        await page.screenshot({ path: file, fullPage: true, mask: [page.locator(PII_SELECTOR)], maskColor: '#9ca3af' })
        console.log(`찍음: ${file}`)
      }
      await context.close()
      if (blocked.length > 0) break
    }
  } finally {
    await browser.close()
  }

  if (blocked.length > 0) {
    throw new Error(`쓰기 요청이 막혔습니다(${blocked.length}건). 이 결과는 쓰지 마세요.\n${blocked.join('\n')}`)
  }
  if (closedSockets.length > 0) console.log(`닫은 WebSocket ${closedSockets.length}건(서버에 잇지 않음).`)
  console.log(`끝: ${outputDir}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.mode === 'login') return login(options)
  if (options.mode === 'capture') return capture(options)
  throw new Error('사용법: admin-visual-snapshot.mjs login | capture --label <이름> --paths /admin/a,/admin/b [--base URL]')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
