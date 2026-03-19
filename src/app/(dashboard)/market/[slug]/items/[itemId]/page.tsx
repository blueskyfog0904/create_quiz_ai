import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { getVisibleMarketMenuEntryBySlug } from '@/lib/market-menu-server'
import { getPublishedMarketItemById, listMarketItemFiles } from '@/lib/market-items-server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MarketItemDetailPageProps {
  params: Promise<{ slug: string; itemId: string }>
}

const formatDate = (value?: string | null) => value ? value.slice(0, 10) : '-'

export default async function MarketItemDetailPage({ params }: MarketItemDetailPageProps) {
  await requireAuth()
  const { slug, itemId } = await params

  const category = await getVisibleMarketMenuEntryBySlug(slug)
  if (!category) {
    notFound()
  }

  const item = await getPublishedMarketItemById(itemId)
  if (!item || item.menu_entry_id !== category.id) {
    notFound()
  }

  const files = await listMarketItemFiles(item.id)
  const hasSample = files.some((file) => file.asset_kind === 'sample')
  const hasPdf = files.some((file) => file.asset_kind === 'pdf')
  const hasHwp = files.some((file) => file.asset_kind === 'hwp')

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                <span>문제마켓</span>
                <span>/</span>
                <span>{category.title}</span>
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
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-gray-500">샘플 파일</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">{hasSample ? '무료' : '미제공'}</p>
                <Button className="mt-3 w-full" variant="outline" disabled={!hasSample}>
                  샘플 다운로드 준비 중
                </Button>
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-sm text-gray-500">PDF</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">{hasPdf ? `${item.pdf_price} 크레딧` : '미제공'}</p>
                <Button className="mt-3 w-full" disabled={!hasPdf}>
                  PDF 구매 기능 준비 중
                </Button>
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-sm text-gray-500">HWP</p>
                <p className="mt-2 text-lg font-semibold text-gray-900">{hasHwp ? `${item.hwp_price} 크레딧` : '미제공'}</p>
                <Button className="mt-3 w-full" disabled={!hasHwp}>
                  HWP 구매 기능 준비 중
                </Button>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
