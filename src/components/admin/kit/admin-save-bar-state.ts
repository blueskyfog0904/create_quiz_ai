// 저장 바의 표시·버튼 규칙(20번 5-2). React 없이 돌아가는 순수 규칙이라 시험이 직접 실행한다.
// - 실패여도 저장 안 된 변경이 없으면(예: 충돌로 다시 읽은 뒤) '변경 없음'으로 보이고 [다시 시도]를 막는다.
// - saveWhenClean: 변경이 없어도 버튼을 켠다(화면이 누름을 받아 검사·초점 이동을 하는 경우).

export type AdminSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export type AdminSaveBarKind = 'saving' | 'error' | 'dirty' | 'saved' | 'clean'

export function adminSaveBarView(input: {
  status: AdminSaveStatus
  dirtyCount: number
  hasSavedAt: boolean
  saveDisabled?: boolean
  saveWhenClean?: boolean
}): { kind: AdminSaveBarKind; retry: boolean; disabled: boolean } {
  const { status, dirtyCount, hasSavedAt, saveDisabled = false, saveWhenClean = false } = input
  const dirty = dirtyCount > 0
  let kind: AdminSaveBarKind
  if (status === 'saving') kind = 'saving'
  else if (status === 'error' && dirty) kind = 'error'
  else if (dirty) kind = 'dirty'
  else if (status === 'saved' && hasSavedAt) kind = 'saved'
  else kind = 'clean'
  return {
    kind,
    retry: kind === 'error',
    disabled: kind === 'saving' || saveDisabled || (!dirty && !saveWhenClean),
  }
}

// 저장 안 된 변경 수: 마지막으로 저장된 값과 다른 칸(맨 위 키) 수. 화면이 dirtyCount 로 넘긴다.
export function countChangedFields(current: object, saved: object): number {
  const a = current as Record<string, unknown>
  const b = saved as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let changed = 0
  for (const key of keys) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) changed += 1
  return changed
}
