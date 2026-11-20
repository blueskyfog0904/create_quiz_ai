import type { ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { getAdminMemberDetail, type MemberDetailSection } from '@/lib/admin-member-detail-server'
import { ADMIN_GRANT_SOURCE_CATEGORIES, getAdminCreditTransactionKind } from '@/lib/admin-credit-transaction-kind'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { RevokeCreditButton } from './revoke-credit-button'
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

const KIND_TONE_CLASS = {
  green: 'text-green-700',
  amber: 'text-amber-800',
  blue: 'text-blue-700',
  red: 'text-red-700',
  gray: 'text-gray-700',
} as const

const LINK_CLASS = 'text-blue-700 underline-offset-2 hover:underline'

const CONSENT_SOURCE_LABELS: Record<string, string> = {
  email_signup: '이메일 가입',
  kakao_signup: '카카오 가입',
  consent_gate: '동의 화면',
  mypage: '선택 동의 관리',
}

const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'
const formatSigned = (amount: number) => `${amount > 0 ? '+' : ''}${amount.toLocaleString()}`

// 권한이 없어 읽지 않은 구역은 그리지 않고, 읽지 못한 구역은 "없음"과 구분해 알린다.
function Section<T>({ title, section, link, children }: {
  title: string
  section: MemberDetailSection<T>
  link?: { href: string; label: string } | null
  children: (data: T) => ReactNode
}) {
  if (!section) return null
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        {link && <Link href={link.href} className={`text-sm ${LINK_CLASS}`}>{link.label}</Link>}
      </CardHeader>
      <CardContent>
        {section.failed ? (
          <p role="alert" className="text-sm text-red-700">불러오지 못했습니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.</p>
        ) : children(section.data)}
      </CardContent>
    </Card>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-500">{children}</p>
}

function RecentNote({ shown, total }: { shown: number; total: number }) {
  return total > shown ? <p className="mt-2 text-xs text-gray-500">전체 {total.toLocaleString()}건 중 최근 {shown}건입니다.</p> : null
}

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireAdminPagePermission('members.view')
  const { id } = await params
  const detail = await getAdminMemberDetail(access, id)
  if (!detail) notFound()

  const { profile } = detail
  // 각 관리 화면을 이 회원의 이메일로 검색한 상태로 연다(부분 일치라 비슷한 이메일의 다른 회원이 섞일 수 있다. 이메일이 없으면 링크를 두지 않는다).
  const emailQuery = profile.email ? encodeURIComponent(profile.email) : null
  const orderHref = (tab: 'payments' | 'market', query: string) => `/admin/orders?tab=${tab}&q=${encodeURIComponent(query)}`
  // 회수: 회수 권한이 있고 본인 계정이 아닐 때, 관리자 지급분 중 쓸 수 있는(활성·만료 전) 건에만 버튼을 둔다. 판정은 회수 함수(DB)가 다시 한다.
  const canRevoke = hasAdminPermission(access, 'credits.revoke') && profile.id !== access.userId

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users" className={`text-sm ${LINK_CLASS}`}>← 사용자 관리</Link>
        <h1 className="mt-2 text-3xl font-bold text-gray-900 max-md:text-2xl">회원 상세</h1>
        <p className="mt-1 text-gray-500">고객 문의에 답할 때 회원의 결제·크레딧·구매 이력을 보는 화면입니다. 잘못 지급한 크레딧의 회수도 여기서 합니다.</p>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <span className="break-all">{formatMemberDisplayName(profile.email, profile.display_tag)}</span>
            {profile.is_admin && <Badge className="bg-orange-100 text-orange-700">관리자</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            {([
              ['이메일', profile.email || '-'],
              ['전화번호', profile.phone || '-'],
              ['가입일', formatDateTime(profile.created_at)],
              ['가입 방식', profile.provider || '-'],
            ] as const).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-gray-500">{label}</dt>
                <dd className="min-w-0 break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Section title="크레딧" section={detail.credits}>
        {(credits) => (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <p className="text-2xl font-bold text-gray-900">{credits.spendableBalance.toLocaleString()} C</p>
              <p className="text-sm text-gray-500">지금 쓸 수 있는 잔액</p>
              {credits.nextExpirationAt && <p className="text-sm text-gray-500">가장 가까운 만료 {formatDateTime(credits.nextExpirationAt)}</p>}
              {credits.expiredBalance > 0 && <p className="text-sm text-gray-500">만료되어 못 쓰는 크레딧 {credits.expiredBalance.toLocaleString()} C</p>}
            </div>
            {credits.sources.length === 0 ? (
              <Empty>남은 수량이 있는 크레딧이 없습니다.</Empty>
            ) : (
              <Table className="max-md:min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>받은 날</TableHead>
                    <TableHead>구분</TableHead>
                    <TableHead className="text-right">남은 수량</TableHead>
                    <TableHead>만료일</TableHead>
                    <TableHead>상태</TableHead>
                    {canRevoke && <TableHead className="text-right">회수</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credits.sources.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell className="text-xs text-gray-500">{formatDateTime(source.purchased_at)}</TableCell>
                      <TableCell className="text-sm">
                        {getCreditSourceCategoryLabel({ status: source.status, plan: source.plan, sourceCategory: source.source_category } as CreditSourceDisplayInput)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{source.remaining_credits.toLocaleString()} / {source.initial_credits.toLocaleString()}</TableCell>
                      <TableCell className="text-sm">{source.expires_at ? formatDateTime(source.expires_at) : '만료 없음'}</TableCell>
                      <TableCell className="text-sm">
                        {source.status === 'active' && source.expires_at && source.expires_at <= credits.databaseNow
                          ? '만료됨'
                          : labelOf(CREDIT_SOURCE_STATUS_LABELS, source.status)}
                      </TableCell>
                      {canRevoke && (
                        <TableCell className="text-right">
                          {ADMIN_GRANT_SOURCE_CATEGORIES.includes(source.source_category)
                            && source.status === 'active'
                            && !(source.expires_at && source.expires_at <= credits.databaseNow)
                            && source.remaining_credits > 0 ? (
                              <RevokeCreditButton
                                sourceId={source.id}
                                remaining={source.remaining_credits}
                                sourceLabel={`${formatDateTime(source.purchased_at)} ${getCreditSourceCategoryLabel({ status: source.status, plan: source.plan, sourceCategory: source.source_category } as CreditSourceDisplayInput)}`}
                              />
                            ) : null}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {credits.sourcesTruncated && <p className="text-xs text-gray-500">남은 수량이 있는 크레딧이 많아 최근 {credits.sources.length}건만 보입니다.</p>}
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
            <Table className="max-md:min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>주문 시각</TableHead>
                  <TableHead>요금제</TableHead>
                  <TableHead>결제수단</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>주문번호</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="text-xs text-gray-500">{formatDateTime(order.createdAt)}</TableCell>
                    <TableCell>
                      <div className="text-sm">{order.planName}</div>
                      <div className="text-xs text-gray-500">{order.amount.toLocaleString()}원 · {order.credits.toLocaleString()} 크레딧</div>
                    </TableCell>
                    <TableCell className="text-sm">{order.methodLabel ?? labelOf(PAYMENT_PROVIDER_LABELS, order.provider)}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-wrap items-center gap-1">
                        {labelOf(PAYMENT_ORDER_STATUS_LABELS, order.status)}
                        {order.environment !== 'live' && <Badge variant="outline">{labelOf(PAYMENT_ENVIRONMENT_LABELS, order.environment)}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link href={orderHref('payments', order.orderId)} className={`font-mono text-xs ${LINK_CLASS}`}>{order.orderId}</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            {downloadsUnavailable && <p role="alert" className="mb-2 text-sm text-red-700">다운로드 기록을 불러오지 못했습니다. 아래 다운로드 횟수는 실제와 다를 수 있습니다.</p>}
            <Table className="max-md:min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>구매 시각</TableHead>
                  <TableHead>상품</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>다운로드</TableHead>
                  <TableHead className="text-right">진단</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="text-xs text-gray-500">{formatDateTime(order.createdAt)}</TableCell>
                    <TableCell>
                      <div className="text-sm">{order.item?.title ?? '-'}</div>
                      <div className="text-xs text-gray-500">{labelOf(WORKSPACE_SUBJECT_LABELS, order.workspaceSubject)} · {order.chargedCredits.toLocaleString()} 크레딧</div>
                    </TableCell>
                    <TableCell className="text-sm">{labelOf(MARKET_ORDER_STATUS_LABELS, order.status)}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {order.download.downloadableCount === order.download.fileCount && order.download.fileCount > 0
                          ? `받을 수 있음 (파일 ${order.download.fileCount}개)`
                          : `받을 수 있는 파일 ${order.download.downloadableCount}/${order.download.fileCount} · ${labelOf(MARKET_DOWNLOAD_BLOCK_REASON_LABELS, order.download.reason)}`}
                      </div>
                      <div className="text-xs text-gray-500">
                        {downloadsUnavailable
                          ? '받은 기록 확인 불가'
                          : order.downloads.count === 0 && !downloadsTruncated
                            ? '받은 기록 없음'
                            : `받은 기록 ${order.downloads.count.toLocaleString()}회${downloadsTruncated ? ' 이상 (기록이 많아 최근 것만 읽었습니다)' : ''}${order.downloads.latestAt ? ` · 최근 ${formatDateTime(order.downloads.latestAt)}` : ''}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={orderHref('market', order.id)} className={`text-sm ${LINK_CLASS}`}>주문 상세</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <Table className="max-md:min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead>일시</TableHead>
                  <TableHead>유형</TableHead>
                  <TableHead>내용</TableHead>
                  <TableHead className="text-right">변동</TableHead>
                  <TableHead className="text-right">거래 후 잔액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((transaction) => {
                  const kind = getAdminCreditTransactionKind(transaction)
                  return (
                    <TableRow key={transaction.id}>
                      <TableCell className="text-xs text-gray-500">{formatDateTime(transaction.created_at)}</TableCell>
                      <TableCell className={`text-sm font-medium ${KIND_TONE_CLASS[kind.tone]}`}>{kind.label}</TableCell>
                      <TableCell className="text-sm">{transaction.description || '-'}</TableCell>
                      <TableCell className={`text-right font-bold ${transaction.amount > 0 ? 'text-green-600' : 'text-red-600'}`}>{formatSigned(transaction.amount)}</TableCell>
                      <TableCell className="text-right text-sm">{transaction.balance_after.toLocaleString()}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-gray-500">최근 거래만 보입니다(최대 50건).</p>
          </>
        )}
      </Section>

      <Section title="충전 환불 요청" section={detail.paymentRefunds} link={{ href: '/admin/refunds', label: '환불 관리' }}>
        {({ requests, totalCount }) => requests.length === 0 ? <Empty>충전 환불 요청이 없습니다.</Empty> : (
          <>
            <ul className="divide-y text-sm">
              {requests.map((request) => (
                <li key={request.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {labelOf(REFUND_REQUEST_STATUS_LABELS, request.status)} · {labelOf(REFUND_REQUEST_ORIGIN_LABELS, request.origin)}
                    </span>
                    <span>
                      {request.refund_amount == null ? '환불액 미정' : `${request.refund_amount.toLocaleString()}원`}
                      {request.amountIsRequestBasis && request.refund_amount != null && <span className="ml-1 text-xs text-gray-500">신청 기준액</span>}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-gray-500">
                    {request.order ? (
                      <>
                        {request.order.plan_name_snapshot} · <Link href={orderHref('payments', request.order.order_id)} className={`font-mono ${LINK_CLASS}`}>{request.order.order_id}</Link> ·{' '}
                      </>
                    ) : null}
                    요청 {formatDateTime(request.created_at)} · 처리 {formatDateTime(request.processed_at)}
                  </p>
                  {request.reason && <p className="mt-1 break-all text-xs text-gray-600">사유: {request.reason}</p>}
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
            <ul className="divide-y text-sm">
              {requests.map((request) => (
                <li key={request.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{labelOf(MARKET_REFUND_REQUEST_STATUS_LABELS, request.status)} · {request.item?.title ?? '-'}</span>
                    <span>
                      요청 {request.requested_refund_credits.toLocaleString()} 크레딧
                      {request.approved_refund_credits != null && ` · 승인 ${request.approved_refund_credits.toLocaleString()} 크레딧`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {request.order_id && (
                      <>
                        <Link href={orderHref('market', request.order_id)} className={LINK_CLASS}>주문 상세</Link> ·{' '}
                      </>
                    )}
                    요청 {formatDateTime(request.created_at)} · 처리 {formatDateTime(request.processed_at)}
                  </p>
                  {request.reason && <p className="mt-1 break-all text-xs text-gray-600">사유: {request.reason}</p>}
                </li>
              ))}
            </ul>
            <RecentNote shown={requests.length} total={totalCount} />
          </>
        )}
      </Section>

      <Section title="문의" section={detail.supportTickets} link={{ href: '/admin/support', label: '문의 관리' }}>
        {({ tickets, totalCount }) => tickets.length === 0 ? <Empty>문의가 없습니다.</Empty> : (
          <>
            <ul className="divide-y text-sm">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={`/admin/support?ticket=${ticket.id}`} className={`break-all font-medium ${LINK_CLASS}`}>{ticket.subject}</Link>
                    <p className="mt-0.5 text-xs text-gray-500">
                      접수 {formatDateTime(ticket.created_at)}{ticket.responded_at && ` · 답변 ${formatDateTime(ticket.responded_at)}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">{labelOf(SUPPORT_TICKET_STATUS_LABELS, ticket.status)}</Badge>
                    {ticket.is_deleted_by_user && <Badge variant="outline" className="border-red-300 text-red-700">회원이 삭제함</Badge>}
                  </div>
                </li>
              ))}
            </ul>
            <RecentNote shown={tickets.length} total={totalCount} />
          </>
        )}
      </Section>

      <Section title="약관 동의" section={detail.consents}>
        {(history) => history.length === 0 ? <Empty>동의 기록이 없습니다.</Empty> : (
          <ul className="divide-y text-sm">
            {history.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    [{entry.required ? '필수' : '선택'}] {entry.itemLabel} <span className="text-xs font-normal text-gray-500">버전 {entry.itemVersion}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {formatDateTime(entry.createdAt)} · {CONSENT_SOURCE_LABELS[entry.source] ?? entry.source}
                  </p>
                </div>
                <Badge variant="outline" className={entry.agreed ? '' : 'border-red-300 text-red-700'}>{entry.agreed ? '동의' : '동의하지 않음'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
