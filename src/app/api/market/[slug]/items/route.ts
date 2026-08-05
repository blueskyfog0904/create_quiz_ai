import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_WORKSPACE_SUBJECT } from '@/lib/workspace-subject'
import {
  getVisibleMarketMenuEntryBySlugForWorkspace,
  listPublishedMarketItems,
  type MarketItemListFilters,
} from '@/lib/market-items-server'

export const dynamic = 'force-dynamic'

function normalizeQueryText(value: string) {
  return value.normalize('NFC').trim()
}

const QuerySchema = z.object({
  subject: z.enum(['english', 'korean']).default(DEFAULT_WORKSPACE_SUBJECT),
  search: z.string().trim().optional(),
  assetKind: z.enum(['all', 'sample', 'pdf', 'hwp', 'zip']).optional(),
  gradeLevel: z.string().trim().optional(),
  examYear: z.coerce.number().int().optional(),
  examMonth: z.coerce.number().int().min(1).max(12).optional(),
  sort: z.enum(['latest', 'views', 'price_asc']).optional(),
  sourceType: z.string().transform(normalizeQueryText).optional(),
  source1: z.string().transform(normalizeQueryText).optional(),
  source2: z.string().transform(normalizeQueryText).optional(),
  source3: z.string().transform(normalizeQueryText).optional(),
  source4: z.string().transform(normalizeQueryText).optional(),
})

interface RouteContext {
  params: Promise<{ slug: string }>
}

export async function GET(request: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const { slug } = await params
  const query = Object.fromEntries(new URL(request.url).searchParams.entries())
  const parsed = QuerySchema.safeParse(query)

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message || '조회 조건이 올바르지 않습니다.' },
    }, { status: 400 })
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  try {
    const marketMenuEntry = await getVisibleMarketMenuEntryBySlugForWorkspace(slug, parsed.data.subject)
    if (!marketMenuEntry) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제마켓 카테고리를 찾을 수 없습니다.' } }, { status: 404 })
    }

    const filters: MarketItemListFilters = {
      search: parsed.data.search,
      assetKind: parsed.data.assetKind,
      gradeLevel: parsed.data.gradeLevel,
      examYear: parsed.data.examYear,
      examMonth: parsed.data.examMonth,
      sort: parsed.data.sort,
      sourceType: parsed.data.sourceType,
      source1: parsed.data.source1,
      source2: parsed.data.source2,
      source3: parsed.data.source3,
      source4: parsed.data.source4,
    }

    const items = await listPublishedMarketItems(marketMenuEntry.id, filters)

    return NextResponse.json({
      success: true,
      data: {
        category: marketMenuEntry,
        items,
        filters,
      },
    })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 목록을 불러오지 못했습니다.',
      },
    }, { status: 500 })
  }
}
