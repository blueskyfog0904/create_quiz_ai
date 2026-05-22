import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { CalendarDays, Eye, FileArchive, FileText, GraduationCap, PackageCheck, Sparkles } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import {
  getVisibleMarketMenuEntryBySlugForWorkspace,
  getPublishedMarketItemById,
  listCompletedMarketPurchasesForItem,
  listMarketItemFiles,
} from '@/lib/market-items-server'
import { listActiveMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import MarketItemActions from './market-item-actions'

interface MarketItemDetailPageProps {
  params: Promise<{ slug: string; itemId: string }>
  searchParams?: Promise<{ subject?: string }>
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

function MetaSummaryItem({ icon, label, value }: { icon: ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  )
}

export default async function MarketItemDetailPage({ params, searchParams }: MarketItemDetailPageProps) {
  const { user } = await getUser()
  const { slug, itemId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined

  const category = await getVisibleMarketMenuEntryBySlugForWorkspace(slug, resolveWorkspaceSubject(resolvedSearchParams?.subject))
  if (!category) {
    notFound()
  }

  const item = await getPublishedMarketItemById(itemId, category.workspace_subject)
  if (!item || item.menu_entry_id !== category.id) {
    notFound()
  }

  const files = await listMarketItemFiles(item.id, false, item.workspace_subject)
  const samplePages = await listActiveMarketItemSamplePages(item.id, item.workspace_subject)
  const purchases = user
    ? await listCompletedMarketPurchasesForItem(user.id, item.id, item.workspace_subject)
    : []
  const hasSamplePages = samplePages.length > 0
  const hasLegacySample = files.some((file) => file.asset_kind === 'sample')
  const hasSample = hasSamplePages || hasLegacySample
  const hasPdf = files.some((file) => file.asset_kind === 'pdf')
  const hasHwp = files.some((file) => file.asset_kind === 'hwp')
  const ownsPdf = purchases.some((purchase) => purchase.asset_kind === 'pdf' || purchase.asset_kind === 'hwp')
  const ownsHwp = purchases.some((purchase) => purchase.asset_kind === 'hwp')
  const sources = collectSources(item)
  const ownedCount = Number(ownsPdf) + Number(ownsHwp)
  const fileLabels = [hasPdf ? 'PDF' : null, hasHwp ? 'HWP & PDF' : null].filter(Boolean).join(' · ') || '제공 파일 없음'

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-200">
        <CardHeader className="border-b bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                <span>문제마켓</span>
                <span>/</span>
                <WorkspaceLink className="hover:text-white" href={`/market/${category.slug}`}>{category.title}</WorkspaceLink>
              </div>
              <CardTitle className="max-w-4xl text-3xl leading-tight tracking-tight text-white">{item.title}</CardTitle>
              <CardDescription className="max-w-3xl text-slate-200">
                {item.summary || '샘플을 확인한 뒤 PDF/HWP 자료를 선택해 구매할 수 있습니다.'}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {hasSample ? <Badge className="bg-white/15 text-white hover:bg-white/15"><Sparkles className="mr-1 h-3 w-3" />샘플 제공</Badge> : null}
              {hasPdf ? <Badge className="bg-white/15 text-white hover:bg-white/15">PDF</Badge> : null}
              {hasHwp ? <Badge className="bg-white/15 text-white hover:bg-white/15">HWP & PDF</Badge> : null}
              {ownedCount > 0 ? <Badge className="bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/20">구매 완료 {ownedCount}건</Badge> : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetaSummaryItem icon={<CalendarDays className="h-4 w-4" />} label="게시일" value={formatDate(item.published_at || item.created_at)} />
            <MetaSummaryItem icon={<Eye className="h-4 w-4" />} label="조회수" value={item.view_count.toLocaleString()} />
            <MetaSummaryItem icon={<GraduationCap className="h-4 w-4" />} label="학년" value={item.grade_level || '-'} />
            <MetaSummaryItem icon={<FileArchive className="h-4 w-4" />} label="제공 파일" value={fileLabels} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),360px]">
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-dashed bg-slate-50/60">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><FileText className="h-5 w-5 text-slate-500" />시험 정보</CardTitle>
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
                      <span className="text-gray-500">카테고리</span>
                      <span className="font-medium text-gray-900">{category.title}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-gray-500">보유 상태</span>
                      {user ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Badge variant={ownsPdf ? 'default' : 'outline'}>PDF {ownsPdf ? '보유' : '미보유'}</Badge>
                          <Badge variant={ownsHwp ? 'default' : 'outline'}>HWP & PDF {ownsHwp ? '보유' : '미보유'}</Badge>
                        </div>
                      ) : (
                        <span className="text-sm font-medium text-gray-900">로그인 후 확인</span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-dashed bg-slate-50/60">
                  <CardHeader>
                    <CardTitle className="text-lg">출처</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-gray-600">
                    {sources.length > 0 ? (
                      <ul className="space-y-2">
                        {sources.map((source, index) => (
                          <li key={`${source}-${index}`} className="rounded-xl border bg-white px-3 py-2 text-gray-700">
                            {source}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-xl border border-dashed bg-white px-3 py-6 text-center text-gray-500">등록된 출처 정보가 없습니다.</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="border-dashed bg-slate-50/60">
                <CardHeader>
                  <CardTitle className="text-lg">상세 설명</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-7 text-gray-600">
                  {item.description || '상세 설명은 아직 등록되지 않았습니다.'}
                </CardContent>
              </Card>
            </div>

            <Card className="h-fit lg:sticky lg:top-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><PackageCheck className="h-5 w-5 text-slate-500" />파일 선택</CardTitle>
                <CardDescription>샘플을 확인한 뒤 필요한 파일만 구매하세요.</CardDescription>
              </CardHeader>
              <CardContent>
                <MarketItemActions
                  hasHwp={hasHwp}
                  hasLegacySample={hasLegacySample}
                  hasPdf={hasPdf}
                  hasSamplePages={hasSamplePages}
                  hwpPrice={item.hwp_price}
                  itemId={item.id}
                  isLoggedIn={Boolean(user)}
                  ownsHwp={ownsHwp}
                  ownsPdf={ownsPdf}
                  pdfPrice={item.pdf_price}
                  samplePageCount={samplePages.length}
                  workspaceSubject={item.workspace_subject}
                />
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
