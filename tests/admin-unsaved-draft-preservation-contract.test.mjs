import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readProductAdminSource } from './helpers/product-admin-sources.mjs'

// docs/admin-site-settings-ux-proposal.md 4-1: 즉시 저장 뒤 다시 읽을 때 저장 안 한 입력이 말없이 사라지던 문제 5건
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('상품 폼: 서브상품·파일 즉시 저장 뒤 다시 읽어도 저장 전 전체구매 입력은 남고, 배지는 입력=서버 값일 때만 저장됨', () => {
  const client = readProductAdminSource()
  // 다시 읽기(refreshEditingFiles)는 고친 전체구매 입력을 지킨다.
  assert.match(client, /const refreshEditingFiles = async \(id: string\) => \{\s+const detail = await fetchItemDetail\(id\)\s+applyItemDetail\(detail, \{ keepBundleDraft: true \}\)/)
  // 첫 업로드 때 자동 임시저장(persistBundleOption 을 건너뜀)도 같은 규칙.
  assert.match(client, /applyItemDetail\(detail, \{ keepBundleDraft: options\.draftSource === 'auto_upload' \}\)/)
  // 고쳤는지는 마지막 서버 값과 비교해 판단한다(고치지 않았으면 서버 값으로 맞춤).
  assert.match(client, /options\.keepBundleDraft && !isSameBundleForm\(current, previousServerForm\) \? current : nextServerForm/)
  // 상품을 열 때(loadItemDetail)는 서버 값으로 맞춘다.
  assert.match(client, /setSavedCategoryItemId\(getItemCategoryItemId\(detail\.item\)\)\n {4}applyItemDetail\(detail\)\n {4}setSamplePages/)
  // 새 상품 작성 때 서버 값 기억도 비운다.
  assert.match(client, /setBundleOption\(null\)\n {4}bundleOptionRef\.current = null/)
  // 배지: 입력이 서버 값과 다르면 '저장 안 됨'.
  assert.match(client, /!isSameBundleForm\(bundleForm, buildBundleFormFromOption\(bundleOption\)\)[\s\S]{0,200}저장 안 됨/)
  assert.match(client, /전체구매 설정은 아래 저장 버튼을 눌러야 저장됩니다/)
})

test('메뉴관리: 한쪽을 저장해 다시 읽어도 다른 영역의 저장 안 한 변경은 남고, 떠날 때 확인한다', () => {
  const client = read('src/app/(admin)/admin/menu-management/menu-management-client.tsx')
  assert.match(client, /useEffect\(\(\) => \{\s+setSavedConfig\(cloneConfig\(initialConfig\)\)\s+if \(!hasUnsavedChangesRef\.current\) \{/)
  assert.match(client, /useEffect\(\(\) => \{\s+setSavedAdminSidebarConfig\(initialAdminSidebarConfig\)\s+if \(!hasUnsavedAdminSidebarChangesRef\.current\) \{/)
  assert.match(client, /useUnsavedChangesGuard\(hasUnsavedChanges \|\| hasUnsavedAdminSidebarChanges\)/)
  // 버튼 + router.push 이동(과목 전환, 알림 열기)도 같은 확인을 거친다.
  const switcher = read('src/components/layout/admin-workspace-switcher.tsx')
  assert.match(switcher, /if \(!confirmLeaveIfUnsaved\(\)\) \{\s+return\s+\}\s+const nextSearchParams/)
  const alerts = read('src/components/admin/admin-alert-context.tsx')
  assert.match(alerts, /&& confirmLeaveIfUnsaved\(\)\) \{\s+router\.push\(link\)/)
  // 저장 전에는 완료형 알림을 쓰지 않는다.
  assert.doesNotMatch(client, /'메뉴를 삭제했습니다\.'|'메뉴를 추가했습니다\.'|'시스템 메뉴를 숨김 처리했습니다\.'/)
  assert.match(client, /위의 저장을 눌러야 적용됩니다/)
})

test('이탈 경고 훅: 창 닫기·새로고침과 같은 사이트 안 링크 이동을 확인하고, 변경이 없으면 아무것도 걸지 않는다', () => {
  const hook = read('src/hooks/use-unsaved-changes-guard.ts')
  assert.match(hook, /if \(!hasUnsavedChanges\) return/)
  assert.match(hook, /addEventListener\('beforeunload'/)
  assert.match(hook, /document\.addEventListener\('click', handleClick, true\)/)
  assert.match(hook, /nextUrl\.origin !== window\.location\.origin\) return/)
  assert.match(hook, /anchor\.target === '_blank'/)
  assert.match(hook, /removeEventListener\('beforeunload'/)
  // 버튼 이동용 확인: 지키는 화면이 없으면 묻지 않는다.
  assert.match(hook, /if \(activeGuardCount === 0\) return true/)
  assert.match(hook, /activeGuardCount \+= 1/)
  assert.match(hook, /activeGuardCount -= 1/)
})

test('후기 태그: 한 행을 저장해도 다른 행의 고친 입력은 남고, 모두 저장으로 한 번에 저장하며, 떠날 때 확인한다', () => {
  const client = read('src/app/(admin)/admin/review-tags/review-tags-client.tsx')
  assert.match(client, /const loadTags = useCallback\(async \(resetIds: string\[\] = \[\]\) =>/)
  assert.match(client, /!resetIds\.includes\(tag\.id\) && isEdited \? draft :/)
  assert.match(client, /await loadTags\(payload\.label !== undefined \|\| payload\.sort_order !== undefined \? \[tagId\] : \[\]\)/)
  // 모두 저장: 고친 행을 차례로 저장하고, 실패해도 저장된 행만 서버 값으로 맞춘다. 떠날 때 확인.
  assert.match(client, /for \(const tag of dirtyTags\)/)
  assert.match(client, /finally \{\s+await loadTags\(savedIds\)/)
  assert.match(client, /useUnsavedChangesGuard\(dirtyTags\.length > 0\)/)
  // 20번 1단계: '모두 저장' 버튼은 아래 고정 저장 바(저장 함수 하나 = saveAllDrafts)가 그린다.
  assert.match(client, /<AdminSaveBar\s+variant="fixed"[\s\S]*?onSave=\{\(\) => void saveAllDrafts\(\)\}\s+saveLabel="모두 저장"/)
  assert.doesNotMatch(client, /setDrafts\(Object\.fromEntries\(rows\.map/)
})

test('관리자 ID: 비밀번호 재설정·새 계정은 확인 칸이 일치해야 보낸다', () => {
  const client = read('src/app/(admin)/admin/admin-accounts/admin-accounts-client.tsx')
  // 표 안의 가려진 칸 하나로 바로 바꾸던 방식은 없다.
  assert.doesNotMatch(client, /passwordDrafts/)
  // 20번 3단계: 브라우저 알림 창 대신 같은 문구를 화면 안 오류 띠(AdminNotice)로 보이고 보내지 않는다.
  assert.match(client, /if \(resetPasswordValue !== resetPasswordConfirm\) \{\s+setPasswordError\('비밀번호 확인이 일치하지 않습니다\.'\)\s+return/)
  assert.match(client, /\|\| resetPasswordValue !== resetPasswordConfirm\n/)
  assert.match(client, /if \(newPassword !== newPasswordConfirm\) \{\s+setCreateError\('비밀번호 확인이 일치하지 않습니다\.'\)\s+return/)
  assert.match(client, /\{passwordError \? <AdminNotice kind="error">\{passwordError\}<\/AdminNotice> : null\}/)
  assert.match(client, /\{createError \? <AdminNotice kind="error" className="mt-3">\{createError\}<\/AdminNotice> : null\}/)
  assert.match(client, /<DialogTitle>비밀번호 재설정<\/DialogTitle>/)
})

test('모달은 바깥을 눌러도 닫히지 않고 X·취소·실행 버튼으로만 닫힌다(사이트·관리자 공용 부품)', () => {
  const dialog = read('src/components/ui/dialog.tsx')
  assert.match(dialog, /onInteractOutside=\{\(event\) => \{\s+onInteractOutside\?\.\(event\)\s+event\.preventDefault\(\)/)
  // 넘겨받은 onInteractOutside 가 props 펼침으로 덮어쓰지 못하게 펼침 뒤에 둔다.
  assert.match(dialog, /\{\.\.\.props\}\n\s+onInteractOutside=/)
})
