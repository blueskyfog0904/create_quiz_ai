import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { DEFAULT_WORKSPACE_SUBJECT } from '@/lib/workspace-subject'
import {
  getVisibleMarketMenuEntryBySlugForWorkspace,
  getPublishedMarketItemById,
  listCompletedMarketPurchasesForItem,
  listMarketItemFiles,
} from '@/lib/market-items-server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import MarketItemActions from './market-item-actions'

interface MarketItemDetailPageProps {
  params: Promise<{ slug: string; itemId: string }>
}

const formatDate = (value?: string | null) => value ? value.slice(0, 10) : '-'
const formatExamLabel = (year?: number | null, month?: number | null) => {
  if (!year && !month) {
    return '-'
  }

  return [year ? `${year}년` : null, month ? `${month}월` : null].filter(Boolean).join(' ')
}

const collectSources = (item: Awaited<ReturnType<typeof getPublishedMarketItemById>>) => {
  if (!item) {
    return []
  }

  return [item.source_1, item.source_2, item.source_3, item.source_4].filter(Boolean) as string[]
}

export default async function MarketItemDetailPage({ params }: MarketItemDetailPageProps) {
  const user = await requireAuth()
  const { slug, itemId } = await params

  const category = await getVisibleMarketMenuEntryBySlugForWorkspace(slug, DEFAULT_WORKSPACE_SUBJECT)
  if (!category) {
    notFound()
  }

  const item = await getPublishedMarketItemById(itemId, category.workspace_subject)
  if (!item || item.menu_entry_id !== category.id) {
    notFound()
  }

  const files = await listMarketItemFiles(item.id, false, item.workspace_subject)
  const purchases = await listCompletedMarketPurchasesForItem(user.id, item.id, item.workspace_subject)
  const hasSample = files.some((file) => file.asset_kind === 'sample')
  const hasPdf = files.some((file) => file.asset_kind === 'pdf')
  const hasHwp = files.some((file) => file.asset_kind === 'hwp')
  const ownsPdf = purchases.some((purchase) => purchase.asset_kind === 'pdf')
  const ownsHwp = purchases.some((purchase) => purchase.asset_kind === 'hwp')
  const sources = collectSources(item)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                <span>문제마켓</span>
                <span>/</span>
                <Link className="hover:text-gray-900" href={`/market/${category.slug}`}>{category.title}</Link>
              </div>
              <CardTitle className="text-3xl">{item.title}</CardTitle>
              {item.summary ? <p className="text-sm text-gray-500">{item.summary}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {hasSample ? <Badge variant="secondary">샘플 제공</Badge> : null}
              {hasPdf ? <Badge variant="outline">PDF</Badge> : null}
              {hasHwp ? <Badge variant="outline">HWP</Badge> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr),320px]">
          <div className="space-y-6">
            <div className="grid gap-3 rounded-xl border bg-gray-50 p-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-gray-500">게시일</p>
                <p className="mt-1 text-sm font-medium">{formatDate(item.published_at || item.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">조회수</p>
                <p className="mt-1 text-sm font-medium">{item.view_count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">학년</p>
                <p className="mt-1 text-sm font-medium">{item.grade_level || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">카테고리</p>
                <p className="mt-1 text-sm font-medium">{category.title}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle className="text-lg">자료 정보</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-600">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-500">시험 회차</span>
                    <span className="font-medium text-gray-900">{formatExamLabel(item.exam_year, item.exam_month)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-500">출제 타입</span>
                    <span className="font-medium text-gray-900">{item.source_type || '-'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-500">보유 상태</span>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Badge variant={ownsPdf ? 'default' : 'outline'}>PDF {ownsPdf ? '보유' : '미보유'}</Badge>
                      <Badge variant={ownsHwp ? 'default' : 'outline'}>HWP {ownsHwp ? '보유' : '미보유'}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-dashed">
                <CardHeader>
                  <CardTitle className="text-lg">출처</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-gray-600">
                  {sources.length > 0 ? (
                    <ul className="space-y-2">
                      {sources.map((source, index) => (
                        <li key={`${source}-${index}`} className="rounded-md bg-gray-50 px-3 py-2 text-gray-700">
                          {source}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>등록된 출처 정보가 없습니다.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-lg">상세 설명</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-6 text-gray-600">
                {item.description || '상세 설명은 아직 등록되지 않았습니다.'}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">구매 / 다운로드</CardTitle>
            </CardHeader>
            <CardContent>
              <MarketItemActions
                hasHwp={hasHwp}
                hasPdf={hasPdf}
                hasSample={hasSample}
                hwpPrice={item.hwp_price}
                itemId={item.id}
                ownsHwp={ownsHwp}
                ownsPdf={ownsPdf}
                pdfPrice={item.pdf_price}
              />
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
