import { createClient } from '@/lib/supabase/server'
import { requireAuth } from '@/lib/auth'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteExamPaperButton } from './delete-button'

export default async function ExamPapersPage() {
  await requireAuth()
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: examPapers, error } = await supabase
    .from('exam_papers')
    .select('*')
    .eq('user_id', user!.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error("Error fetching exam papers:", error)
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">문제지 관리</h1>
          <p className="text-gray-500">생성된 시험지를 관리합니다.</p>
        </div>
        <Link href="/bank">
          <Button>+ 새 문제지 만들기</Button>
        </Link>
      </div>

      {!examPapers || examPapers.length === 0 ? (
        <Card className="text-center py-16">
          <CardContent>
            <p className="text-gray-500 mb-4">생성된 문제지가 없습니다.</p>
            <Link href="/bank">
              <Button>문제 은행에서 문제지 만들기</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {examPapers.map((paper) => (
            <Card key={paper.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="line-clamp-2">{paper.paper_title}</CardTitle>
                {paper.description && (
                  <CardDescription className="line-clamp-3">
                    {paper.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex-grow">
                <div className="space-y-2 text-sm text-gray-600">
                  <p>📅 생성일: {new Date(paper.created_at).toLocaleDateString('ko-KR')}</p>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Link href={`/exam-papers/${paper.id}`} className="flex-1">
                  <Button variant="outline" className="w-full">
                    보기
                  </Button>
                </Link>
                <DeleteExamPaperButton paperId={paper.id} />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

