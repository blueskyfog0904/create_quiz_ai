import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { readPiiAllowedContacts, readSiteBoardAdminData } from '@/lib/site-board-server'
import { readLinkedBroadcastCounts } from '@/lib/member-broadcast-server'
import { BoardAdmin } from './board-admin'

// 14번 7절: 공지사항 관리(content.manage). 쓰기는 서버 액션 → DB 함수만. 가림은 대표만 보인다.
export default async function AdminNoticesPage() {
  const access = await requireAdminPagePermission('content.manage')
  // eslint-disable-next-line react-hooks/purity -- 서버 컴포넌트다. 공지 팝업 연결(켜짐·끝) 판정을 요청 시각으로 한다.
  const nowMs = Date.now()
  const [data, piiAllowed] = await Promise.all([readSiteBoardAdminData('notice', nowMs), readPiiAllowedContacts()])
  // 16번: 이 글로 보낸(회수하지 않은) 공지 알림 수 — 숨김·삭제·가림 확인 창 경고. 읽지 못하면 null(확인 못 함).
  const linkedBroadcasts = data.preview ? {} : await readLinkedBroadcastCounts([...data.posts, ...data.deletedPosts].map((post) => post.id))
  const isOwner = hasAdminPermission(access, 'owner')
  return <BoardAdmin data={data} canRedact={isOwner} canBroadcast={isOwner} linkedBroadcasts={linkedBroadcasts} piiAllowed={piiAllowed} />
}
