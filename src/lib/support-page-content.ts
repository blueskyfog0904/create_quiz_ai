// 13번 묶음 9절: 고객지원 회원 화면 문구(system_settings 'support_page_content')의 규칙. 문구 자체는 DB 에만 있다(코드에 기본 문구 없음).
// 값 모양: { revision, member: { 키: 문자열 }, admin: { templateBlankMarker, answerEditReasonGuide, accessLogRetentionYears } }
// 16번: 답변·답변 수정 알림 문구와 켜기(옛 answer*Notification*·notifyOnAnswerEdit)는 '알림' 화면(member_notification_texts)으로 옮겼다.
//   DB 에 남은 옛 키는 읽지 않고, 이 탭은 그 키 없이 저장한다(정리 스크립트가 지운다 — 16번 계획 5-6).
// 필수/선택의 기준은 계획 10-1 표의 '필수/선택' 칸 하나다. 필수 키 목록(SUPPORT_PAGE_REQUIRED_KEYS)을 저장 검사·마이그레이션 VERIFY·화면 해석이 같이 쓴다.
// 필수 키가 없거나 비면 해석은 null(화면은 오류 화면), 선택 키가 비면 그 칸만 숨긴다.

export const SUPPORT_PAGE_CONTENT_SETTING_KEY = 'support_page_content'
export const SUPPORT_PAGE_CONTENT_CACHE_TAG = 'support_page_content'

// 10-1 표의 모든 member 키(표 순서) — 무리별로 관리자 화면에 칸을 그린다.
export const SUPPORT_PAGE_MEMBER_KEY_GROUPS = [
  {
    label: '안내',
    keys: ['pageTitle', 'pageDescription', 'formTitle', 'formNotice', 'responseTimeNote', 'defaultCategoryHelp',
      'historyTitle', 'historyIntro', 'emptyTitle', 'emptyDescription'],
  },
  {
    label: '입력',
    keys: ['categoryLabel', 'categoryPlaceholder', 'subjectLabel', 'messageLabel', 'defaultSubjectPlaceholder',
      'defaultMessagePlaceholder', 'submitLabel', 'submittingLabel', 'uncategorizedLabel'],
  },
  {
    label: '수정 폼',
    keys: ['editCategoryLabel', 'editSubjectLabel', 'editMessageLabel', 'editSubjectPlaceholder', 'editMessagePlaceholder',
      'cancelLabel', 'saveEditLabel', 'editIconTitle', 'deleteIconTitle'],
  },
  {
    label: '알림·창',
    keys: ['needCategoryToast', 'needContentToast', 'deletedToast', 'updatedToast', 'submittedTitle', 'submittedDescription',
      'deleteConfirmTitle', 'deleteConfirmDescription', 'deleteConfirmLabel', 'submitFailedToast', 'updateFailedToast', 'deleteFailedToast'],
  },
  {
    label: '답변',
    keys: ['answerLabel', 'answerEditedLabel'],
  },
] as const

export type SupportPageMemberKey = (typeof SUPPORT_PAGE_MEMBER_KEY_GROUPS)[number]['keys'][number]

export const SUPPORT_PAGE_MEMBER_KEYS: readonly SupportPageMemberKey[] = SUPPORT_PAGE_MEMBER_KEY_GROUPS.flatMap((group) => [...group.keys])

// 10-1 표의 '선택' 키(비면 그 칸을 숨긴다). 나머지는 모두 필수.
const OPTIONAL_MEMBER_KEYS: readonly SupportPageMemberKey[] = [
  'pageDescription', 'formNotice', 'responseTimeNote', 'defaultCategoryHelp', 'historyIntro', 'emptyDescription',
  'defaultSubjectPlaceholder', 'defaultMessagePlaceholder', 'answerEditedLabel',
]

// 필수 키(10-1 표 순서). 저장 검사·VERIFY·해석이 같이 쓴다.
export const SUPPORT_PAGE_REQUIRED_KEYS: readonly SupportPageMemberKey[] = SUPPORT_PAGE_MEMBER_KEYS.filter((key) => !OPTIONAL_MEMBER_KEYS.includes(key))

// 관리자 화면 칸 이름(관리자 글, 회원 문구 아님)
export const SUPPORT_PAGE_MEMBER_KEY_LABELS: Record<SupportPageMemberKey, string> = {
  pageTitle: '화면 제목(탭 제목)',
  pageDescription: '탭 설명',
  formTitle: '문의 쓰기 제목',
  formNotice: '문의 쓰기 위쪽 안내',
  responseTimeNote: '응답 시간 안내',
  defaultCategoryHelp: '카테고리 기본 안내',
  historyTitle: '문의 내역 제목',
  historyIntro: '문의 내역 안내',
  emptyTitle: '빈 화면 제목',
  emptyDescription: '빈 화면 설명',
  categoryLabel: '카테고리 칸 이름',
  categoryPlaceholder: '카테고리 선택 안내',
  subjectLabel: '제목 칸 이름',
  messageLabel: '내용 칸 이름',
  defaultSubjectPlaceholder: '제목 기본 예시',
  defaultMessagePlaceholder: '내용 기본 예시',
  submitLabel: '등록 버튼',
  submittingLabel: '등록 중 버튼',
  uncategorizedLabel: '카테고리 없음 표시',
  editCategoryLabel: '수정: 카테고리 칸 이름',
  editSubjectLabel: '수정: 제목 칸 이름',
  editMessageLabel: '수정: 내용 칸 이름',
  editSubjectPlaceholder: '수정: 제목 예시',
  editMessagePlaceholder: '수정: 내용 예시',
  cancelLabel: '취소 버튼',
  saveEditLabel: '수정 완료 버튼',
  editIconTitle: '수정 아이콘 이름',
  deleteIconTitle: '삭제 아이콘 이름',
  needCategoryToast: '카테고리 미선택 알림',
  needContentToast: '제목·내용 미입력 알림',
  deletedToast: '삭제 완료 알림',
  updatedToast: '수정 완료 알림',
  submittedTitle: '접수 완료 창 제목',
  submittedDescription: '접수 완료 창 설명(응답 약속)',
  deleteConfirmTitle: '삭제 확인 창 제목',
  deleteConfirmDescription: '삭제 확인 창 설명',
  deleteConfirmLabel: '삭제 확인 버튼',
  submitFailedToast: '등록 실패 알림',
  updateFailedToast: '수정 실패 알림',
  deleteFailedToast: '삭제 실패 알림',
  answerLabel: '답변 이름',
  answerEditedLabel: '답변 수정 표시(비우면 숨김)',
}

// 한 칸 글자 수 상한(관리자 저장 검사)
export const SUPPORT_PAGE_TEXT_MAX = 500

export type SupportPageMemberTexts = Record<SupportPageMemberKey, string>

export interface SupportPageAdminSettings {
  // 템플릿 빈칸 표시(DB 값이지만 관리자 화면에서 고치지 않는다 — 템플릿과 함께 스크립트로)
  templateBlankMarker: string
  answerEditReasonGuide: string
  // 처리방침 3절 '기록한 날부터 N년'과 같아야 한다(관리자 화면에서 고치지 않는다)
  accessLogRetentionYears: number
}

export interface SupportPageContent {
  revision: number
  member: SupportPageMemberTexts
  admin: SupportPageAdminSettings
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// DB 값을 해석한다. 행 없음·JSON 깨짐·필수 키 없음/빈 값·admin 값 형식 어긋남이면 null.
export function parseSupportPageContent(value: unknown): SupportPageContent | null {
  if (!isRecord(value) || !isRecord(value.member) || !isRecord(value.admin)) return null
  const revision = value.revision
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) return null
  const member = {} as SupportPageMemberTexts
  for (const key of SUPPORT_PAGE_MEMBER_KEYS) {
    const text = value.member[key]
    if (text === undefined || text === null) {
      if (SUPPORT_PAGE_REQUIRED_KEYS.includes(key)) return null
      member[key] = ''
      continue
    }
    if (typeof text !== 'string') return null
    if (SUPPORT_PAGE_REQUIRED_KEYS.includes(key) && !text.trim()) return null
    member[key] = text
  }
  const admin = value.admin
  if (typeof admin.templateBlankMarker !== 'string' || !admin.templateBlankMarker.trim()) return null
  if (typeof admin.answerEditReasonGuide !== 'string') return null
  if (typeof admin.accessLogRetentionYears !== 'number' || !Number.isInteger(admin.accessLogRetentionYears) || admin.accessLogRetentionYears < 1) return null
  return {
    revision,
    member,
    admin: {
      templateBlankMarker: admin.templateBlankMarker,
      answerEditReasonGuide: admin.answerEditReasonGuide,
      accessLogRetentionYears: admin.accessLogRetentionYears,
    },
  }
}

export interface SupportPageContentInput {
  revision: number
  member: Record<string, unknown>
  admin: { answerEditReasonGuide?: unknown; templateBlankMarker?: unknown; accessLogRetentionYears?: unknown }
}

// 관리자 저장 검사(지금 값 current 와 비교). 고칠 수 있는 것: member 전부, admin.answerEditReasonGuide.
// admin.templateBlankMarker·accessLogRetentionYears 는 화면에서 고치지 않는다 — 보냈는데 지금 값과 다르면 거부한다.
export function validateSupportPageContentInput(
  input: SupportPageContentInput,
  current: SupportPageContent
): { ok: true; content: SupportPageContent } | { ok: false; error: string } {
  if (!isRecord(input) || !isRecord(input.member) || !isRecord(input.admin)) return { ok: false, error: '입력값 형식이 올바르지 않습니다.' }
  if (input.revision !== current.revision) return { ok: false, error: 'REVISION_CONFLICT' }
  const member = {} as SupportPageMemberTexts
  for (const key of SUPPORT_PAGE_MEMBER_KEYS) {
    const raw = input.member[key]
    if (raw !== undefined && typeof raw !== 'string') return { ok: false, error: `${SUPPORT_PAGE_MEMBER_KEY_LABELS[key]} 값이 올바르지 않습니다.` }
    const text = (raw ?? '').trim()
    if (SUPPORT_PAGE_REQUIRED_KEYS.includes(key) && !text) return { ok: false, error: `${SUPPORT_PAGE_MEMBER_KEY_LABELS[key]}은(는) 비울 수 없습니다.` }
    if (text.length > SUPPORT_PAGE_TEXT_MAX) return { ok: false, error: `${SUPPORT_PAGE_MEMBER_KEY_LABELS[key]}은(는) ${SUPPORT_PAGE_TEXT_MAX}자 이하로 적어 주세요.` }
    member[key] = text
  }
  const { admin } = input
  if (admin.templateBlankMarker !== undefined && admin.templateBlankMarker !== current.admin.templateBlankMarker) {
    return { ok: false, error: '빈칸 표시는 관리자 화면에서 고칠 수 없습니다.' }
  }
  if (admin.accessLogRetentionYears !== undefined && admin.accessLogRetentionYears !== current.admin.accessLogRetentionYears) {
    return { ok: false, error: '열람 기록 보관 기간은 관리자 화면에서 고칠 수 없습니다(처리방침과 같아야 합니다).' }
  }
  const guide = typeof admin.answerEditReasonGuide === 'string' ? admin.answerEditReasonGuide.trim() : current.admin.answerEditReasonGuide
  if (guide.length > SUPPORT_PAGE_TEXT_MAX) return { ok: false, error: `수정 사유 안내는 ${SUPPORT_PAGE_TEXT_MAX}자 이하로 적어 주세요.` }
  return {
    ok: true,
    content: {
      revision: current.revision + 1,
      member,
      admin: {
        templateBlankMarker: current.admin.templateBlankMarker,
        answerEditReasonGuide: guide,
        accessLogRetentionYears: current.admin.accessLogRetentionYears,
      },
    },
  }
}
