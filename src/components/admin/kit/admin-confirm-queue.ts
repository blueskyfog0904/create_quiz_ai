// useAdminConfirm 의 약속 처리(20번 5-3). React 없이 돌아가는 순수 규칙이라 시험이 직접 실행한다.
// - 확정: ask → true, askReason → 다듬은 사유 글
// - 취소(Esc·[취소]·화면이 사라짐): ask → false, askReason → null
// - 창이 열린 채 다른 확인이 오면 앞 약속은 취소로 풀린다(영영 안 풀리는 일 없게).

export type AdminConfirmRequest<ConfirmOptions, ReasonOptions> =
  | { type: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { type: 'reason'; options: ReasonOptions; resolve: (reason: string | null) => void }

export function createAdminConfirmQueue<ConfirmOptions, ReasonOptions>(
  onChange: (request: AdminConfirmRequest<ConfirmOptions, ReasonOptions> | null) => void
) {
  let current: AdminConfirmRequest<ConfirmOptions, ReasonOptions> | null = null

  const cancel = (request: AdminConfirmRequest<ConfirmOptions, ReasonOptions>) => {
    if (request.type === 'confirm') request.resolve(false)
    else request.resolve(null)
  }

  const open = (next: AdminConfirmRequest<ConfirmOptions, ReasonOptions>) => {
    const previous = current
    current = next
    if (previous) cancel(previous)
    onChange(next)
  }

  return {
    ask: (options: ConfirmOptions) => new Promise<boolean>((resolve) => open({ type: 'confirm', options, resolve })),
    askReason: (options: ReasonOptions) => new Promise<string | null>((resolve) => open({ type: 'reason', options, resolve })),
    // 열린 확인을 끝낸다. 열린 것이 없으면 아무 일도 없다.
    settle(confirmed: boolean, reason = '') {
      const request = current
      if (!request) return
      current = null
      onChange(null)
      if (request.type === 'confirm') request.resolve(confirmed)
      else request.resolve(confirmed ? reason.trim() : null)
    },
  }
}
