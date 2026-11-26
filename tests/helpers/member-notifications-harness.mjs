import { readFileSync } from 'node:fs'
import { load } from './market-images-harness.mjs'

// 16번 묶음: route·웹훅 시험이 쓰는 '@/lib/member-notifications-server' 대역.
// 실제 규칙(src/lib/member-notifications.ts)과 마이그레이션 첫 값(답변 두 종류는 13번 첫 값 복사)으로 그리고,
// 그린 행을 insert(row) 로 넘긴다 — 기존 시험이 보던 notifications 행(user_id·title·message·link·type)을 그대로 볼 수 있다.
// 공용 함수의 실제 동작(문구 읽기·캐시·서버 키 INSERT)은 tests/bundle16-member-notifications-contract.test.mjs 가 본다.

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
export const memberNotificationRules = load('src/lib/member-notifications.ts')

// 마이그레이션 첫 값 + 13번 support_page_content 첫 값의 답변 문구(마이그레이션이 적용 순간에 복사하는 것과 같은 대응표)
export function seedMemberNotificationTexts() {
  const migration = read('supabase/migrations/20261218100000_bundle16_member_notifications.sql')
  const texts = JSON.parse(migration.match(/\$json_member_notification_texts\$([\s\S]*?)\$json_member_notification_texts\$/)[1])
  const support = JSON.parse(read('supabase/migrations/20261217110000_bundle13_cs_tools.sql')
    .match(/\$json_support_page_content\$([\s\S]*?)\$json_support_page_content\$/)[1])
  texts.kinds.supportAnswerCreated.title = support.member.answerCreatedNotificationTitle
  texts.kinds.supportAnswerCreated.message = support.member.answerCreatedNotificationMessage
  texts.kinds.supportAnswerEdited.title = support.member.answerEditedNotificationTitle
  texts.kinds.supportAnswerEdited.message = support.member.answerEditedNotificationMessage
  texts.kinds.supportAnswerEdited.enabled = support.admin.notifyOnAnswerEdit
  return texts
}

// sent: 보낸 요청(kind·userId·values…) 기록. insert: 그린 행을 받는다({ error } 또는 예외로 실패를 흉내).
export function memberNotificationsServer({ texts = seedMemberNotificationTexts(), insert = async () => ({ error: null }), sent = [] } = {}) {
  const rules = memberNotificationRules
  return {
    sent,
    async sendMemberNotification(request) {
      sent.push(request)
      if (!texts) return { sent: false, reason: 'texts_unavailable' }
      if (!rules.isMemberNotificationEnabled(request.kind, texts)) return { sent: false, reason: 'disabled' }
      const rendered = rules.renderMemberNotification(request.kind, texts, request)
      if (!rendered) return { sent: false, reason: 'render_failed' }
      try {
        const result = await insert({ user_id: request.userId, type: rendered.type, title: rendered.title, message: rendered.message, link: rendered.link, is_read: false })
        if (result?.error) return { sent: false, reason: 'insert_failed' }
      } catch {
        return { sent: false, reason: 'insert_failed' }
      }
      return { sent: true }
    },
    notificationFailed: (result) => !result.sent && result.reason !== 'disabled',
    getMemberNotificationTexts: async () => texts,
  }
}
