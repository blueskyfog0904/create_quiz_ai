import { redirect } from 'next/navigation'
import { isWorkspaceSubject } from '@/lib/workspace-subject'

// 상품 상세는 /items/[itemId]로 옮겼다. next.config의 redirect가 먼저 걸리므로 이 page는 예비용이다(S4에서 삭제).
export default async function LegacySolvookMarketItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; itemId: string }>
  searchParams: Promise<{ subject?: string | string[] }>
}) {
  const [{ itemId }, { subject }] = await Promise.all([params, searchParams])
  const subjectValue = Array.isArray(subject) ? subject[0] : subject
  redirect(`/items/${itemId}${isWorkspaceSubject(subjectValue) ? `?subject=${subjectValue}` : ''}`)
}
