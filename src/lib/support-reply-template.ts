// 13번 묶음 6절: 답변 템플릿의 자리표시 채우기와 빈칸 찾기(순수 함수). 템플릿 글은 DB(support_reply_templates)에 있다.
// 자리표시는 코드에 정한 세 가지뿐이다. 회원 개인정보 자리표시는 두지 않는다(답변 글에 개인정보가 복사되면 가림 대상이 늘어난다).
// 빈칸(사람이 채울 곳)은 DB 값 support_page_content.admin.templateBlankMarker(예: ○○)로 적는다.

export const SUPPORT_REPLY_PLACEHOLDERS = ['{사이트이름}', '{문의제목}', '{접수일}'] as const

export type SupportReplyPlaceholder = (typeof SUPPORT_REPLY_PLACEHOLDERS)[number]

export const SUPPORT_REPLY_TEMPLATE_TITLE_MAX = 60
export const SUPPORT_REPLY_TEMPLATE_BODY_MAX = 4000

export interface SupportReplyTemplateValues {
  siteName: string
  ticketSubject: string
  // 한국 날짜(YYYY.MM.DD)로 만든 접수일
  receivedDate: string
}

// 템플릿 글 안의 {…} 가운데 정한 세 가지가 아닌 것(중복 없이, 나온 순서)
export function findUnknownPlaceholders(body: string): string[] {
  const found = [...body.matchAll(/\{[^{}\n]*\}/g)].map((match) => match[0])
  return [...new Set(found.filter((token) => !(SUPPORT_REPLY_PLACEHOLDERS as readonly string[]).includes(token)))]
}

// 템플릿 저장 검사: 제목 1~60자, 본문 1~4000자, 모르는 자리표시 거부. 통과하면 null, 아니면 오류 문장.
export function validateSupportReplyTemplate(input: { title: string; body: string }): string | null {
  const title = input.title.trim()
  const body = input.body.trim()
  if (!title || title.length > SUPPORT_REPLY_TEMPLATE_TITLE_MAX) return `템플릿 이름은 1~${SUPPORT_REPLY_TEMPLATE_TITLE_MAX}자로 적어 주세요.`
  if (!body || body.length > SUPPORT_REPLY_TEMPLATE_BODY_MAX) return `템플릿 본문은 1~${SUPPORT_REPLY_TEMPLATE_BODY_MAX}자로 적어 주세요.`
  const unknown = findUnknownPlaceholders(body)
  if (unknown.length > 0) return `쓸 수 없는 자리표시가 있습니다: ${unknown.join(', ')} (쓸 수 있는 것: ${SUPPORT_REPLY_PLACEHOLDERS.join(', ')})`
  return null
}

// 자리표시 세 가지를 채운다. 다른 글(빈칸 표시 포함)은 그대로 둔다.
export function fillSupportReplyTemplate(body: string, values: SupportReplyTemplateValues): string {
  const map: Record<SupportReplyPlaceholder, string> = {
    '{사이트이름}': values.siteName,
    '{문의제목}': values.ticketSubject,
    '{접수일}': values.receivedDate,
  }
  return body.replace(/\{[^{}\n]*\}/g, (token) => (token in map ? map[token as SupportReplyPlaceholder] : token))
}

// 빈칸 표시가 남은 자리(글자 위치). 표시가 비어 있으면 찾지 않는다.
export function findTemplateBlanks(text: string, marker: string): number[] {
  if (!marker) return []
  const positions: number[] = []
  let index = text.indexOf(marker)
  while (index !== -1) {
    positions.push(index)
    index = text.indexOf(marker, index + marker.length)
  }
  return positions
}

// 미리보기용: 글을 빈칸 표시 기준으로 나눈다(빈칸 조각은 blank: true).
export function splitTemplateBlanks(text: string, marker: string): { text: string; blank: boolean }[] {
  if (!marker || !text.includes(marker)) return [{ text, blank: false }]
  const parts: { text: string; blank: boolean }[] = []
  text.split(marker).forEach((part, index) => {
    if (index > 0) parts.push({ text: marker, blank: true })
    if (part) parts.push({ text: part, blank: false })
  })
  return parts
}

// 충돌 확인용: 화면에 보인 지금 답변(없으면 빈 글)의 UTF-8 sha256 소문자 hex. DB 함수가 같은 값과 비교한다
// (encode(sha256(convert_to(COALESCE(admin_response, ''), 'UTF8')), 'hex')).
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
