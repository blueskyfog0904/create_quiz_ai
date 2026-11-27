import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AdminDataTable } from '@/components/admin/kit/admin-data-table'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { ADMIN_TONE_TEXT_CLASSES } from '@/components/admin/kit/admin-tone-classes'
import { formatCount, formatCredits, formatSignedCredits, formatWon } from '@/lib/admin-format'
import { adminStatusTone, creditAmountTone } from '@/lib/admin-status-tone'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { getAdminMemberDetail, type MemberDetailSection } from '@/lib/admin-member-detail-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import type { AdminMemberAccessField } from '@/lib/admin-member-access-log'
import { ADMIN_GRANT_SOURCE_CATEGORIES, getAdminCreditTransactionKind } from '@/lib/admin-credit-transaction-kind'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { RevokeCreditButton } from './revoke-credit-button'
import { MemberWithdrawalPanel } from './member-withdrawal-panel'
import { MemberSuspensionPanel } from './member-suspension-panel'
import { MemberNotesPanel } from './member-notes-panel'
import { getCreditSourceCategoryLabel, type CreditSourceDisplayInput } from '@/lib/credit-source-display'
import { formatMemberDisplayName } from '@/lib/member-display-name'
import {
  CREDIT_SOURCE_STATUS_LABELS,
  MARKET_DOWNLOAD_BLOCK_REASON_LABELS,
  MARKET_ORDER_STATUS_LABELS,
  MARKET_REFUND_REQUEST_STATUS_LABELS,
  PAYMENT_ENVIRONMENT_LABELS,
  PAYMENT_ORDER_STATUS_LABELS,
  PAYMENT_PROVIDER_LABELS,
  REFUND_REQUEST_ORIGIN_LABELS,
  REFUND_REQUEST_STATUS_LABELS,
  WORKSPACE_SUBJECT_LABELS,
  labelOf,
} from '@/lib/admin-orders'

export const metadata = { title: '회원 상세' }

// 문의 상태 이름은 문의 관리 화면(support-client.tsx의 statusConfig)과 같다.
const SUPPORT_TICKET_STATUS_LABELS = {
  pending: '대기 중',
  in_progress: '처리 중',
  resolved: '해결됨',
  closed: '종료',
} as const

const LINK_CLASS = 'text-[var(--studio-primary)] underline-offset-2 hover:underline'

const CONSENT_SOURCE_LABELS: Record<string, string> = {
  email_signup: '이메일 가입',
  kakao_signup: '카카오 가입',
  consent_gate: '동의 화면',
  mypage: '선택 동의 관리',
  withdrawal: '탈퇴(광고 수신 철회)',
}

// 날짜 표기는 지금 모양 그대로(20번: 대표가 바꾸기로 정하기 전까지).
const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'

// 권한이 없어 읽지 않은 구역은 그리지 않고, 읽지 못한 구역은 "없음"과 구분해 알린다.
function Section<T>({ title, section, link, children }: {
  title: string
  section: MemberDetailSection<T>
  link?: { href: string; label: string } | null
  children: (data: T) => ReactNode
}) {
  if (!section) return null
  return (
    <Card className={CARD_CLASS}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        {link && <Link href={link.href} className={`text-sm ${LINK_CLASS}`}>{link.label}</Link>}
      </CardHeader>
      <CardContent>
        {section.failed ? (
          <AdminNotice kind="error">불러오지 못했습니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.</AdminNotice>
        ) : children(section.data)}
      </CardContent>
    </Card>
  )
}

const CARD_CLASS = 'rounded-[var(--studio-radius-card)] border-[var(--studio-border)] shadow-none'

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--studio-muted)]">{children}</p>
}

function RecentNote({ shown, total }: { shown: number; total: number }) {
  return total > shown ? <p className="mt-2 text-xs text-[var(--studio-muted)]">전체 {formatCount(total)}건 중 최근 {shown}건입니다.</p> : null
}

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPagePermission('members.view')
  const { id } = await params
  const detail = await getAdminMemberDetail(access, id)
  if (!detail) notFound()

  // 13번 8절: 회원 연락처(+12번 메모가 보이면 메모)를 보이기 전에 열람 기록을 남긴다(관리자 계정·탈퇴 회원은 대상 아님).
  // 남기지 못하면 이메일·전화를 가린다(Q4 가 — 그 이메일로 여는 검색 링크도 함께 빠진다).
  const shownFields: AdminMemberAccessField[] = ['email', 'phone']
  if (detail.notes && !detail.notes.failed && detail.notes.data.notes.length > 0) shownFields.push('memo')
  const logged = await recordMemberAccess({
    access,
    screen: 'users.detail',
    memberIds: detail.profile.is_admin || detail.profile.withdrawn_at ? [] : [detail.profile.id],
    fields: shownFields,
  })
  const profile = logged ? detail.profile : { ...detail.profile, email: null, phone: null }
  const notesSection: typeof detail.notes = logged || !shownFields.includes('memo') ? detail.notes : { failed: true }
  // 각 관리 화면을 이 회원의 이메일로 검색한 상태로 연다(부분 일치라 비슷한 이메일의 다른 회원이 섞일 수 있다. 이메일이 없으면 링크를 두지 않는다).
  const emailQuery = profile.email ? encodeURIComponent(profile.email) : null
  const orderHref = (tab: 'payments' | 'market', query: string) => `/admin/orders?tab=${tab}&q=${encodeURIComponent(query)}`
  // 회수: 회수 권한이 있고 본인 계정이 아닐 때, 관리자 지급분 중 쓸 수 있는(활성·만료 전) 건에만 버튼을 둔다. 판정은 회수 함수(DB)가 다시 한다.
  const canRevoke = hasAdminPermission(access, 'credits.revoke') && profile.id !== access.userId
  // 약관 이력 화면은 site.manage 가 필요하다(없으면 지문만 글자로).
  const canViewPolicyHistory = hasAdminPermission(access, 'site.manage')
  // 12번: 정지·메모 버튼은 화면·route·DB 가 같은 권한일 때만 보인다(로그인 차단·가림은 대표). 관리자 계정은 정지·메모 대상이 아니다.
  const isMemberTarget = !profile.is_admin && profile.id !== access.userId
  const isOwner = hasAdminPermission(access, 'owner')
  const suspensionCapabilities = { canSuspend: isMemberTarget && hasAdminPermission(access, 'members.suspend'), isOwner }
  const noteCapabilities = { actorId: access.userId, canMemo: !profile.is_admin && hasAdminPermission(access, 'members.memo'), isOwner }
  const activeSuspension = detail.suspension && !detail.suspension.failed ? detail.suspension.data.active : null
  // 익명화하면 지워지는 건수(앱에서 센다 — 10번 함수는 고치지 않음)
  const erasedSuspensionCount = detail.suspension && !detail.suspension.failed ? detail.suspension.data.history.length : 0
  const erasedNoteCount = detail.notes && !detail.notes.failed ? detail.notes.data.notes.length : 0

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users" className={`text-sm ${LINK_CLASS}`}>← 사용자 관리</Link>
        <AdminPageHeader
          className="mb-0 mt-2"
          title="회원 상세"
          description="고객 문의에 답할 때 회원의 결제·크레딧·구매 이력을 보는 화면입니다. 잘못 지급한 크레딧의 회수도 여기서 합니다."
          // 13번 8-3: 이 회원의 개인정보 열람 기록(대표 전용 탭)으로 잇는다.
          meta={isOwner && (
            <Link href={`/admin/audit-log?tab=access&member=${profile.id}`} className={`inline-block text-sm ${LINK_CLASS}`}>이 회원 열람 기록</Link>
          )}
        />
      </div>

      <Card className={CARD_CLASS}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <span data-admin-pii="" className="break-all">{formatMemberDisplayName(profile.email, profile.display_tag)}</span>
            {profile.is_admin && <AdminStatusBadge label="관리자" tone="info" />}
            {activeSuspension && <AdminStatusBadge label="정지 중" tone={adminStatusTone('member', activeSuspension.scope)} />}
            {detail.withdrawal && !detail.withdrawal.failed && detail.withdrawal.data.preview.withdrawnAt && (
              <AdminStatusBadge label={`탈퇴 ${formatDateTime(detail.withdrawal.data.preview.withdrawnAt)}`} tone={adminStatusTone('member', 'withdrawn')} />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            {([
              ['이메일', profile.email || '-', true],
              ['전화번호', profile.phone || '-', true],
              ['가입일', formatDateTime(profile.created_at), false],
              ['가입 방식', profile.provider || '-', false],
            ] as const).map(([label, value, pii]) => (
              <div key={label} className="contents">
                <dt className="text-[var(--studio-muted)]">{label}</dt>
                <dd data-admin-pii={pii ? '' : undefined} className="min-w-0 break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Section title="이용 정지" section={detail.suspension}>
        {(suspension) => <MemberSuspensionPanel userId={profile.id} data={suspension} capabilities={suspensionCapabilities} />}
      </Section>

      <Section title="관리자 메모" section={notesSection}>
        {(notes) => <MemberNotesPanel userId={profile.id} data={notes} capabilities={noteCapabilities} />}
      </Section>

      <Section title="크레딧" section={detail.credits}>
        {(credits) => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-2xl font-bold tabular-nums text-[var(--studio-ink)]">{formatCredits(credits.spendableBalance)}</p>
              <p className="text-sm text-[var(--studio-muted)]">지금 쓸 수 있는 잔액</p>
              {credits.nextExpirationAt && <p className="text-sm text-[var(--studio-muted)]">가장 가까운 만료 {formatDateTime(credits.nextExpirationAt)}</p>}
              {credits.expiredBalance > 0 && <p className="text-sm text-[var(--studio-muted)]">만료되어 못 쓰는 크레딧 {formatCredits(credits.expiredBalance)}</p>}
            </div>
            {credits.sources.length === 0 ? (
              <Empty>남은 수량이 있는 크레딧이 없습니다.</Empty>
            ) : (
              <AdminDataTable
                caption="남은 수량이 있는 크레딧"
                rows={credits.sources}
                getRowKey={(source) => source.id}
                minWidth={640}
                columns={[
                  { key: 'purchasedAt', header: '받은 날', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (source) => formatDateTime(source.purchased_at) },
                  {
                    key: 'category',
                    header: '구분',
                    className: 'text-sm',
                    cell: (source) => getCreditSourceCategoryLabel({ status: source.status, plan: source.plan, sourceCategory: source.source_category } as CreditSourceDisplayInput),
                  },
                  { key: 'remaining', header: '남은 수량', numeric: true, className: 'text-sm', cell: (source) => `${formatCount(source.remaining_credits)} / ${formatCount(source.initial_credits)}` },
                  { key: 'expiresAt', header: '만료일', className: 'text-sm', cell: (source) => (source.expires_at ? formatDateTime(source.expires_at) : '만료 없음') },
                  {
                    key: 'status',
                    header: '상태',
                    cell: (source) => (source.status === 'active' && source.expires_at && source.expires_at <= credits.databaseNow
                      ? <AdminStatusBadge label="만료됨" tone="neutral" />
                      : <AdminStatusBadge label={labelOf(CREDIT_SOURCE_STATUS_LABELS, source.status)} tone={adminStatusTone('creditSource', source.status)} />),
                  },
                  ...(canRevoke ? [{
                    key: 'revoke',
                    header: '회수',
                    align: 'right' as const,
                    cell: (source: (typeof credits.sources)[number]) => (ADMIN_GRANT_SOURCE_CATEGORIES.includes(source.source_category)
                      && source.status === 'active'
                      && !(source.expires_at && source.expires_at <= credits.databaseNow)
                      && source.remaining_credits > 0 ? (
                        <RevokeCreditButton
                          sourceId={source.id}
                          remaining={source.remaining_credits}
                          sourceLabel={`${formatDateTime(source.purchased_at)} ${getCreditSourceCategoryLabel({ status: source.status, plan: source.plan, sourceCategory: source.source_category } as CreditSourceDisplayInput)}`}
                        />
                      ) : null),
                  }] : []),
                ]}
              />
            )}
            {credits.sourcesTruncated && <p className="text-xs text-[var(--studio-muted)]">남은 수량이 있는 크레딧이 많아 최근 {credits.sources.length}건만 보입니다.</p>}
          </div>
        )}
      </Section>

      <Section
        title="충전 결제"
        section={detail.paymentOrders}
        link={emailQuery ? { href: `/admin/orders?tab=payments&q=${emailQuery}`, label: '주문 조회에서 이메일로 검색' } : null}
      >
        {({ orders, totalCount }) => orders.length === 0 ? <Empty>충전 결제가 없습니다.</Empty> : (
          <>
            <AdminDataTable
              caption="충전 결제"
              rows={orders}
              getRowKey={(order) => order.id}
              minWidth={640}
              columns={[
                { key: 'createdAt', header: '주문 시각', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (order) => formatDateTime(order.createdAt) },
                {
                  key: 'plan',
                  header: '요금제',
                  cell: (order) => (
                    <>
                      <div className="text-sm">{order.planName}</div>
                      <div className="text-xs tabular-nums text-[var(--studio-muted)]">{formatWon(order.amount)} · {formatCredits(order.credits)}</div>
                    </>
                  ),
                },
                { key: 'method', header: '결제수단', className: 'text-sm', cell: (order) => order.methodLabel ?? labelOf(PAYMENT_PROVIDER_LABELS, order.provider) },
                {
                  key: 'status',
                  header: '상태',
                  cell: (order) => (
                    <div className="flex flex-wrap items-center gap-1">
                      <AdminStatusBadge label={labelOf(PAYMENT_ORDER_STATUS_LABELS, order.status)} tone={adminStatusTone('paymentOrder', order.status)} />
                      {order.environment !== 'live' && <AdminStatusBadge label={labelOf(PAYMENT_ENVIRONMENT_LABELS, order.environment)} tone="neutral" />}
                    </div>
                  ),
                },
                {
                  key: 'orderId',
                  header: '주문번호',
                  cell: (order) => <Link href={orderHref('payments', order.orderId)} className={`font-mono text-xs ${LINK_CLASS}`}>{order.orderId}</Link>,
                },
              ]}
            />
            <RecentNote shown={orders.length} total={totalCount} />
          </>
        )}
      </Section>

      <Section
        title="마켓 구매·다운로드"
        section={detail.marketOrders}
        link={emailQuery ? { href: `/admin/orders?tab=market&q=${emailQuery}`, label: '주문 조회에서 이메일로 검색' } : null}
      >
        {({ orders, totalCount, downloadsUnavailable, downloadsTruncated }) => orders.length === 0 ? <Empty>마켓 구매가 없습니다.</Empty> : (
          <>
            {downloadsUnavailable && <AdminNotice kind="error" className="mb-2">다운로드 기록을 불러오지 못했습니다. 아래 다운로드 횟수는 실제와 다를 수 있습니다.</AdminNotice>}
            <AdminDataTable
              caption="마켓 구매·다운로드"
              rows={orders}
              getRowKey={(order) => order.id}
              minWidth={640}
              columns={[
                { key: 'createdAt', header: '구매 시각', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (order) => formatDateTime(order.createdAt) },
                {
                  key: 'item',
                  header: '상품',
                  cell: (order) => (
                    <>
                      <div className="text-sm">{order.item?.title ?? '-'}</div>
                      <div className="text-xs tabular-nums text-[var(--studio-muted)]">{labelOf(WORKSPACE_SUBJECT_LABELS, order.workspaceSubject)} · {formatCredits(order.chargedCredits)}</div>
                    </>
                  ),
                },
                {
                  key: 'status',
                  header: '상태',
                  cell: (order) => <AdminStatusBadge label={labelOf(MARKET_ORDER_STATUS_LABELS, order.status)} tone={adminStatusTone('marketOrder', order.status)} />,
                },
                {
                  key: 'download',
                  header: '다운로드',
                  cell: (order) => (
                    <>
                      <div className="text-sm">
                        {order.download.downloadableCount === order.download.fileCount && order.download.fileCount > 0
                          ? `받을 수 있음 (파일 ${order.download.fileCount}개)`
                          : `받을 수 있는 파일 ${order.download.downloadableCount}/${order.download.fileCount} · ${labelOf(MARKET_DOWNLOAD_BLOCK_REASON_LABELS, order.download.reason)}`}
                      </div>
                      <div className="text-xs text-[var(--studio-muted)]">
                        {downloadsUnavailable
                          ? '받은 기록 확인 불가'
                          : order.downloads.count === 0 && !downloadsTruncated
                            ? '받은 기록 없음'
                            : `받은 기록 ${formatCount(order.downloads.count)}회${downloadsTruncated ? ' 이상 (기록이 많아 최근 것만 읽었습니다)' : ''}${order.downloads.latestAt ? ` · 최근 ${formatDateTime(order.downloads.latestAt)}` : ''}`}
                      </div>
                    </>
                  ),
                },
                {
                  key: 'detail',
                  header: '진단',
                  align: 'right',
                  cell: (order) => <Link href={orderHref('market', order.id)} className={`text-sm ${LINK_CLASS}`}>주문 상세</Link>,
                },
              ]}
            />
            <RecentNote shown={orders.length} total={totalCount} />
          </>
        )}
      </Section>

      <Section
        title="크레딧 거래"
        section={detail.creditTransactions}
        link={emailQuery ? { href: `/admin/credits?q=${emailQuery}`, label: '크레딧 관리에서 이메일로 검색' } : null}
      >
        {(transactions) => transactions.length === 0 ? <Empty>크레딧 거래가 없습니다.</Empty> : (
          <>
            <AdminDataTable
              caption="크레딧 거래"
              rows={transactions}
              getRowKey={(transaction) => transaction.id}
              minWidth={640}
              columns={[
                { key: 'createdAt', header: '일시', className: 'whitespace-nowrap text-xs text-[var(--studio-muted)]', cell: (transaction) => formatDateTime(transaction.created_at) },
                {
                  key: 'kind',
                  header: '유형',
                  cell: (transaction) => {
                    const kind = getAdminCreditTransactionKind(transaction)
                    return <AdminStatusBadge label={kind.label} tone={adminStatusTone('creditTransaction', kind.tone)} />
                  },
                },
                { key: 'description', header: '내용', className: 'text-sm', cell: (transaction) => transaction.description || '-' },
                {
                  key: 'amount',
                  header: '변동',
                  numeric: true,
                  cell: (transaction) => {
                    // 20번 Q6: 평범한 사용 차감은 기본 글자색 + '−', 빨강은 회수에만
                    const tone = creditAmountTone(transaction.amount, getAdminCreditTransactionKind(transaction).tone)
                    return <span className={`font-bold ${tone ? ADMIN_TONE_TEXT_CLASSES[tone] : 'text-[var(--studio-ink)]'}`}>{formatSignedCredits(transaction.amount)}</span>
                  },
                },
                { key: 'balanceAfter', header: '거래 후 잔액', numeric: true, className: 'text-sm', cell: (transaction) => formatCredits(transaction.balance_after) },
              ]}
            />
            <p className="mt-2 text-xs text-[var(--studio-muted)]">최근 거래만 보입니다(최대 50건).</p>
          </>
        )}
      </Section>

      <Section title="충전 환불 요청" section={detail.paymentRefunds} link={{ href: '/admin/refunds', label: '환불 관리' }}>
        {({ requests, totalCount }) => requests.length === 0 ? <Empty>충전 환불 요청이 없습니다.</Empty> : (
          <>
            <ul className="divide-y divide-[var(--studio-border)] text-sm">
              {requests.map((request) => (
                <li key={request.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1 font-medium">
                      <AdminStatusBadge label={labelOf(REFUND_REQUEST_STATUS_LABELS, request.status)} tone={adminStatusTone('refundRequest', request.status)} />
                      {labelOf(REFUND_REQUEST_ORIGIN_LABELS, request.origin)}
                    </span>
                    <span className="tabular-nums">
                      {request.refund_amount == null ? '환불액 미정' : formatWon(request.refund_amount)}
                      {request.amountIsRequestBasis && request.refund_amount != null && <span className="ml-1 text-xs text-[var(--studio-muted)]">신청 기준액</span>}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-[var(--studio-muted)]">
                    {request.order ? (
                      <>
                        {request.order.plan_name_snapshot} · <Link href={orderHref('payments', request.order.order_id)} className={`font-mono ${LINK_CLASS}`}>{request.order.order_id}</Link> ·{' '}
                      </>
                    ) : null}
                    요청 {formatDateTime(request.created_at)} · 처리 {formatDateTime(request.processed_at)}
                  </p>
                  {request.reason && <p data-admin-pii="" className="mt-1 break-all text-xs text-[var(--studio-text)]">사유: {request.reason}</p>}
                </li>
              ))}
            </ul>
            <RecentNote shown={requests.length} total={totalCount} />
          </>
        )}
      </Section>

      <Section title="마켓 환불 요청" section={detail.marketRefunds} link={{ href: '/admin/refunds', label: '환불 관리' }}>
        {({ requests, totalCount }) => requests.length === 0 ? <Empty>마켓 환불 요청이 없습니다.</Empty> : (
          <>
            <ul className="divide-y divide-[var(--studio-border)] text-sm">
              {requests.map((request) => (
                <li key={request.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1 font-medium">
                      <AdminStatusBadge label={labelOf(MARKET_REFUND_REQUEST_STATUS_LABELS, request.status)} tone={adminStatusTone('marketRefundRequest', request.status)} />
                      {request.item?.title ?? '-'}
                    </span>
                    <span className="tabular-nums">
                      요청 {formatCredits(request.requested_refund_credits)}
                      {request.approved_refund_credits != null && ` · 승인 ${formatCredits(request.approved_refund_credits)}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--studio-muted)]">
                    {request.order_id && (
                      <>
                        <Link href={orderHref('market', request.order_id)} className={LINK_CLASS}>주문 상세</Link> ·{' '}
                      </>
                    )}
                    요청 {formatDateTime(request.created_at)} · 처리 {formatDateTime(request.processed_at)}
                  </p>
                  {request.reason && <p data-admin-pii="" className="mt-1 break-all text-xs text-[var(--studio-text)]">사유: {request.reason}</p>}
                </li>
              ))}
            </ul>
            <RecentNote shown={requests.length} total={totalCount} />
          </>
        )}
      </Section>

      <Section title="문의" section={detail.supportTickets} link={{ href: '/admin/support', label: '문의 관리' }}>
        {({ tickets, totalCount, withdrawn }) => tickets.length === 0 ? <Empty>문의가 없습니다.</Empty> : (
          <>
            <ul className="divide-y divide-[var(--studio-border)] text-sm">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div data-admin-pii="" className="min-w-0">
                    {/* 탈퇴 회원 문의는 문의 관리 화면에서 대표가 사유를 적고 연다(이 링크로는 열리지 않음). */}
                    {withdrawn
                      ? <span className="break-all font-medium text-[var(--studio-text)]">{ticket.subject}</span>
                      : <Link href={`/admin/support?ticket=${ticket.id}`} className={`break-all font-medium ${LINK_CLASS}`}>{ticket.subject}</Link>}
                    <p className="mt-0.5 text-xs text-[var(--studio-muted)]">
                      접수 {formatDateTime(ticket.created_at)}{ticket.responded_at && ` · 답변 ${formatDateTime(ticket.responded_at)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <AdminStatusBadge label={labelOf(SUPPORT_TICKET_STATUS_LABELS, ticket.status)} tone={adminStatusTone('supportTicket', ticket.status)} />
                    {ticket.is_deleted_by_user && <AdminStatusBadge label="회원이 삭제함" tone={adminStatusTone('supportTicket', 'deleted')} />}
                  </div>
                </li>
              ))}
            </ul>
            <RecentNote shown={tickets.length} total={totalCount} />
          </>
        )}
      </Section>

      <Section title="회원 탈퇴 (대표 전용)" section={detail.withdrawal}>
        {(withdrawal) => (
          <>
            {(activeSuspension || erasedNoteCount > 0) && (
              <AdminNotice kind="warning" className="mb-3">
                익명화하면 정지 기록 {erasedSuspensionCount}건·메모 {erasedNoteCount}건이 지워집니다. 개인정보처리방침 3절에 따라 따로 보관하지 않습니다.
              </AdminNotice>
            )}
            <MemberWithdrawalPanel userId={profile.id} email={profile.email} data={withdrawal} />
          </>
        )}
      </Section>

      <Section title="약관 동의" section={detail.consents}>
        {(history) => history.length === 0 ? <Empty>동의 기록이 없습니다.</Empty> : (
          <ul className="divide-y divide-[var(--studio-border)] text-sm">
            {history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    [{entry.required ? '필수' : '선택'}] {entry.itemLabel} <span className="text-xs font-normal text-[var(--studio-muted)]">버전 {entry.itemVersion}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--studio-muted)]">
                    {formatDateTime(entry.createdAt)} · {CONSENT_SOURCE_LABELS[entry.source] ?? entry.source}
                    {entry.policySha256 ? (
                      canViewPolicyHistory ? (
                        <>
                          {' · '}
                          <Link href={`/admin/footer/policy-history?hash=${entry.policySha256}`} className={LINK_CLASS}>
                            약관 사본 {entry.policySha256.slice(0, 8)}
                          </Link>
                        </>
                      ) : ` · 약관 사본 ${entry.policySha256.slice(0, 8)}`
                    ) : entry.hasPolicy ? ' · 약관 사본 없음' : null}
                  </p>
                </div>
                <AdminStatusBadge label={entry.agreed ? '동의' : '동의하지 않음'} tone={entry.agreed ? 'neutral' : 'danger'} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
