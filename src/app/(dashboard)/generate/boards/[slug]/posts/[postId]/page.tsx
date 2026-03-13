import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireAuth } from '@/lib/auth'
import { getActiveProblemTypes, getGenerateBoardBySlug, getGenerateBoardPost } from '../../../data'

interface BoardPostPageProps {
  params: Promise<{ slug: string; postId: string }>
}

export default async function GenerateBoardPostPage({ params }: BoardPostPageProps) {
  await requireAuth()
  const { slug, postId } = await params

  const board = await getGenerateBoardBySlug(slug)
  if (!board) {
    notFound()
  }

  const [post, problemTypes] = await Promise.all([
    getGenerateBoardPost(board.id, postId),
    getActiveProblemTypes(),
  ])

  if (!post) {
    notFound()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{post.title}</h1>
          <p className="mt-2 text-gray-500">문제 유형을 선택하면 교재형 문제생성으로 이동합니다.</p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/generate/boards/${board.slug}`}>목록으로 돌아가기</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>선택한 지문</CardTitle>
          <CardDescription>
            {post.exam_year ?? '-'} / {post.exam_month ? `${post.exam_month}월` : '-'} / {post.grade_level ?? '-'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-[320px] overflow-y-auto rounded-lg border bg-gray-50 p-4 text-sm leading-7 text-gray-700 whitespace-pre-wrap">
            {post.passage_text}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>문제 유형 선택</CardTitle>
          <CardDescription>기존 문제 유형 테이블을 그대로 사용합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {problemTypes.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-gray-500">활성화된 문제 유형이 없습니다.</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {problemTypes.map((type) => (
                <Link key={type.id} href={`/generate/boards/${board.slug}/posts/${post.id}/generate/${type.id}`}>
                  <Card className="h-full cursor-pointer border-2 transition-shadow hover:shadow-lg hover:border-primary">
                    <CardHeader>
                      <CardTitle className="text-lg">{type.type_name}</CardTitle>
                      {type.description ? <CardDescription>{type.description}</CardDescription> : null}
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
