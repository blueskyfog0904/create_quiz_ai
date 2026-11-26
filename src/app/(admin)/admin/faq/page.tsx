import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { readPiiAllowedContacts, readSiteBoardAdminData } from '@/lib/site-board-server'
import { BoardAdmin } from '../notices/board-admin'

// 14번 7절: 자주 묻는 질문 관리(content.manage). 공지사항과 같은 부품(BoardAdmin)·같은 서버 액션을 쓴다.
export default async function AdminFaqPage() {
  const access = await requireAdminPagePermission('content.manage')
  // eslint-disable-next-line react-hooks/purity -- 서버 컴포넌트다. 공지 팝업 연결 판정을 요청 시각으로 한다.
  const nowMs = Date.now()
  const [data, piiAllowed] = await Promise.all([readSiteBoardAdminData('faq', nowMs), readPiiAllowedContacts()])
  return <BoardAdmin data={data} canRedact={hasAdminPermission(access, 'owner')} piiAllowed={piiAllowed} />
}
