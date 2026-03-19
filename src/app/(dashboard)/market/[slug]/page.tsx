import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { getVisibleMarketMenuEntryBySlug } from '@/lib/market-menu-server'
import { listPublishedMarketItems } from '@/lib/market-items-server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface MarketCategoryPageProps {
  params: Promise<{ slug: string }>
}

const formatDate = (value?: string | null) => value ? value.slice(0, 10) : '-'

export default async function MarketCategoryPage({ params }: MarketCategoryPageProps) {
  await requireAuth()
  const { slug } = await params

  const category = await getVisibleMarketMenuEntryBySlug(slug)
  if (!category) {
    notFound()
  }

  const items = await listPublishedMarketItems(category.id)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="text-3xl">{category.title}</CardTitle>
              <p className="mt-2 text-sm text-gray-500">{category.description || '문제마켓 카테고리별 자료를 둘러보고 샘플/유료 파일 정보를 확인할 수 있습니다.'}</p>
            </div>
            <Badge variant="outline">총 {items.length}건</Badge>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">목록</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-gray-500">
              아직 등록된 문제마켓 자료가 없습니다.
            </div>
          ) : (
            <div className="rounded-lg border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>제목</TableHead>
                    <TableHead>학년</TableHead>
                    <TableHead className="text-center">PDF</TableHead>
                    <TableHead className="text-center">HWP</TableHead>
                    <TableHead className="text-center">조회수</TableHead>
                    <TableHead className="text-center">게시일</TableHead>
                    <TableHead className="text-right">이동</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-gray-900">{item.title}</p>
                          {item.summary ? <p className="text-xs text-gray-500">{item.summary}</p> : null}
                        </div>
                      </TableCell>
                      <TableCell>{item.grade_level || '-'}</TableCell>
                      <TableCell className="text-center">{item.pdf_price > 0 ? `${item.pdf_price}C` : '-'}</TableCell>
                      <TableCell className="text-center">{item.hwp_price > 0 ? `${item.hwp_price}C` : '-'}</TableCell>
                      <TableCell className="text-center">{item.view_count}</TableCell>
                      <TableCell className="text-center">{formatDate(item.published_at || item.created_at)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/market/${category.slug}/items/${item.id}`}>
                              상세보기
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
