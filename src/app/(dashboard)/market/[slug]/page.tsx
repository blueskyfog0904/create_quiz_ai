import { notFound } from 'next/navigation'
import { Store } from 'lucide-react'
import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface MarketMenuPageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function MarketMenuPage({ params }: MarketMenuPageProps) {
  await requireAuth()
  const { slug } = await params
  const supabase = await createClient()

  const { data: marketEntry, error } = await supabase
    .from('market_menu_entries')
    .select('slug, title')
    .eq('slug', slug)
    .is('deleted_at', null)
    .eq('is_active', true)
    .eq('is_visible', true)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!marketEntry) {
    notFound()
  }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-2xl">
          <Store className="h-6 w-6 text-primary" />
          {marketEntry.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-gray-600">
        <p>이 문제마켓 상세 페이지는 아직 준비 중입니다.</p>
        <p>현재는 좌측 사이드바 구조와 개별 경로만 먼저 연결했습니다.</p>
      </CardContent>
    </Card>
  )
}
