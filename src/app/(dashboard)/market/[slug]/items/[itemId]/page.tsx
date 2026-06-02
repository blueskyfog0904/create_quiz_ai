import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { CalendarDays, Eye, FileArchive, GraduationCap, PackageCheck } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import { getWorkspaceSubjectTheme } from '@/lib/workspace-theme'
import {
  getVisibleMarketMenuEntryBySlugForWorkspace,
  getPublishedMarketItemById,
  getMarketBundlePublicSummary,
  listMarketSubproductDownloadFilesForUser,
  listMarketSubproductPublicSummaries,
  listCompletedMarketPurchasesForItem,
  listMarketItemFiles,
} from '@/lib/market-items-server'
import { listActiveMarketItemSamplePages } from '@/lib/market-sample-pages-server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import MarketItemActions from './market-item-actions'

interface MarketItemDetailPageProps {
  params: Promise<{ slug: string; itemId: string }>
  searchParams?: Promise<{ subject?: string }>
}

const formatDate = (value?: string | null) => value ? value.slice(0, 10) : '-'
const collectSources = (item: Awaited<ReturnType<typeof getPublishedMarketItemById>>) => {
  if (!item) {
    return []
  }

  return [item.source_1, item.source_2, item.source_3, item.source_4].filter(Boolean) as string[]
}

const resolveWorkspaceSubjectLabel = (subject: string) => subject === 'korean' ? '국어' : '영어'

const formatSourcesLabel = (sources: string[]) => sources.length > 0 ? sources.join(' · ') : '-'

const resolveQuestionCountLabel = (item: Awaited<ReturnType<typeof getPublishedMarketItemById>>) => {
  if (!item) {
    return '-'
  }

  if (item.question_count !== null && item.question_count !== undefined) {
    return `${item.question_count}문항`
  }

  const text = [item.title, item.summary, item.description].filter(Boolean).join(' ')
  const match = text.match(/(\d+)\s*(?:문제|문항)/)

  return match ? `${match[1]}문항` : '-'
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
  const subproducts = await listMarketSubproductPublicSummaries(item.id, user?.id, item.workspace_subject)
  const bundleOption = await getMarketBundlePublicSummary(item.id, user?.id, item.workspace_subject)
  const downloadFiles = user
    ? await listMarketSubproductDownloadFilesForUser(user.id, item.id, item.workspace_subject)
    : []
  const purchases = user
    ? await listCompletedMarketPurchasesForItem(user.id, item.id, item.workspace_subject)
    : []
  const hasSamplePages = samplePages.length > 0
  const hasLegacySample = files.some((file) => file.asset_kind === 'sample')
  const hasPdf = files.some((file) => file.asset_kind === 'pdf')
  const hasHwp = files.some((file) => file.asset_kind === 'hwp')
  const hasZip = files.some((file) => file.asset_kind === 'zip')
  const ownsPdf = purchases.some((purchase) => purchase.asset_kind === 'pdf')
  const ownsHwp = purchases.some((purchase) => purchase.asset_kind === 'hwp')
  const ownsZip = purchases.some((purchase) => purchase.asset_kind === 'zip')
  const sources = collectSources(item)
  const v2FileLabels = Array.from(new Set(subproducts.flatMap((subproduct) => subproduct.fileTypes.map((fileType) => fileType.label))))
  const fileLabels = (v2FileLabels.length > 0
    ? v2FileLabels
    : [hasPdf ? 'PDF' : null, hasHwp ? 'HWP & PDF' : null, hasZip ? 'ZIP' : null].filter(Boolean)
  ).join(' · ') || '제공 파일 없음'
  const subjectTheme = getWorkspaceSubjectTheme(item.workspace_subject)
  const materialInfoRows = [
    { label: '과목', value: resolveWorkspaceSubjectLabel(item.workspace_subject) },
    { label: '학년', value: item.grade_level || '-' },
    { label: '출처', value: formatSourcesLabel(sources) },
    { label: '자료유형', value: item.source_type || category.title || '-' },
    { label: '문항 수', value: resolveQuestionCountLabel(item) },
    { label: '등록일자', value: formatDate(item.created_at) },
  ]

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-slate-200 pt-0">
        <CardHeader className={`border-b ${subjectTheme.marketHeroClass} py-8 text-white`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <CardTitle className="max-w-4xl text-3xl leading-tight tracking-tight text-white">{item.title}</CardTitle>
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
              <section className="space-y-5 rounded-2xl bg-white">
                <h2 className="text-lg font-semibold text-gray-900">자료 정보</h2>
                <dl className="grid gap-x-10 gap-y-5 md:grid-cols-2 rounded-2xl bg-slate-50 px-5 py-5 text-sm">
                  {materialInfoRows.map((row) => (
                    <div key={row.label} className="flex gap-6">
                      <dt className="min-w-[72px] text-gray-500">{row.label}</dt>
                      <dd className="break-words font-medium text-gray-800">{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="whitespace-pre-line rounded-2xl bg-slate-50 px-5 py-5 text-sm leading-8 text-gray-600">
                  {item.description || '상세 설명은 아직 등록되지 않았습니다.'}
                </div>
              </section>
            </div>

            <Card className="h-fit lg:sticky lg:top-24">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg"><PackageCheck className="h-5 w-5 text-slate-500" />구매 옵션</CardTitle>
                <CardDescription>무료 샘플과 전체 패키지, 개별 상품을 구분해 확인하세요.</CardDescription>
              </CardHeader>
              <CardContent>
                <MarketItemActions
                  hasHwp={hasHwp}
                  hasLegacySample={hasLegacySample}
                  hasPdf={hasPdf}
                  hasZip={hasZip}
                  hasSamplePages={hasSamplePages}
                  bundleOption={bundleOption}
                  downloadFiles={downloadFiles}
                  hwpPrice={item.hwp_price}
                  itemId={item.id}
                  isLoggedIn={Boolean(user)}
                  ownsHwp={ownsHwp}
                  ownsPdf={ownsPdf}
                  ownsZip={ownsZip}
                  pdfPrice={item.pdf_price}
                  samplePageCount={samplePages.length}
                  subproducts={subproducts}
                  zipPrice={item.zip_price}
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
