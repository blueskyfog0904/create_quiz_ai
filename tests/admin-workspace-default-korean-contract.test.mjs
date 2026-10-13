import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const adminWorkspace = readFileSync(new URL('../src/lib/admin-workspace.ts', import.meta.url), 'utf8')
const switcher = readFileSync(new URL('../src/components/layout/admin-workspace-switcher.tsx', import.meta.url), 'utf8')

test('관리자 화면은 과목이 주소에 없으면 국어로 시작한다', () => {
  assert.match(adminWorkspace, /export const DEFAULT_ADMIN_WORKSPACE_SUBJECT: WorkspaceSubject = 'korean'/)
  assert.match(adminWorkspace, /resolveWorkspaceSubject\(value, DEFAULT_ADMIN_WORKSPACE_SUBJECT\)/)
  // 사용자 화면 기본값(DEFAULT_WORKSPACE_SUBJECT)은 건드리지 않는다
  assert.doesNotMatch(adminWorkspace, /DEFAULT_WORKSPACE_SUBJECT\b/)
})

test('관리자 과목 전환 버튼은 국어가 앞, 영어가 뒤다', () => {
  assert.ok(switcher.indexOf("{ value: 'korean', label: '국어' }") < switcher.indexOf("{ value: 'english', label: '영어' }"))
  assert.notEqual(switcher.indexOf("{ value: 'english', label: '영어' }"), -1)
})
