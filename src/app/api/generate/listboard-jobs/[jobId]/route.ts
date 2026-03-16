import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ jobId: string }>
}

export async function GET(_: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const { jobId } = await params

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const { data: job, error: jobError } = await supabase
    .from('generate_listboard_generation_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.' } }, { status: 404 })
  }

  const { data: jobItems, error: jobItemsError } = await supabase
    .from('generate_listboard_generation_job_items')
    .select('*')
    .eq('job_id', job.id)
    .order('created_at')

  if (jobItemsError) {
    return NextResponse.json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: jobItemsError.message },
    }, { status: 500 })
  }

  const postItemIds = Array.from(new Set((jobItems ?? []).map((item) => item.post_item_id)))
  const problemTypeIds = Array.from(new Set((jobItems ?? []).map((item) => item.problem_type_id)))

  const [{ data: postItems }, { data: problemTypes }] = await Promise.all([
    postItemIds.length > 0
      ? supabase.from('generate_listboard_post_items').select('id, question_number').in('id', postItemIds)
      : Promise.resolve({ data: [] as Array<{ id: string; question_number: string }> }),
    problemTypeIds.length > 0
      ? supabase.from('problem_types').select('id, type_name').in('id', problemTypeIds)
      : Promise.resolve({ data: [] as Array<{ id: string; type_name: string }> }),
  ])

  const postItemMap = new Map((postItems ?? []).map((item) => [item.id, item.question_number]))
  const problemTypeMap = new Map((problemTypes ?? []).map((type) => [type.id, type.type_name]))

  return NextResponse.json({
    success: true,
    data: {
      job,
      items: (jobItems ?? []).map((item) => ({
        ...item,
        question_number: postItemMap.get(item.post_item_id) ?? '-',
        problem_type_name: problemTypeMap.get(item.problem_type_id) ?? '-',
      })),
    },
  })
}
