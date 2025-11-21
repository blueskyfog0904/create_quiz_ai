import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="bg-gray-50">
        <div className="container mx-auto px-4 py-20 text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 word-keep-all">
            선생님을 위한 <br className="md:hidden" /> AI 영어 문제 생성 솔루션
          </h1>
          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto word-keep-all leading-relaxed">
            지문만 입력하세요. <br/>
            AI가 수능형 변형 문제, 내신 대비 문제, 정답 및 상세 해설까지 <br className="hidden md:block" />
            단 몇 초 만에 자동으로 완성해 드립니다.
          </p>
          
          <div className="flex justify-center gap-4">
            {user ? (
              <Link href="/generate">
                <Button size="lg" className="px-8 text-lg">지금 바로 만들기</Button>
              </Link>
            ) : (
              <Link href="/signup">
                <Button size="lg" className="px-8 text-lg">무료로 시작하기</Button>
              </Link>
            )}
            <Link href="/bank">
               <Button variant="outline" size="lg" className="text-lg">예시 문제 보기</Button>
            </Link>
          </div>
        </div>

        {/* Feature Section (Optional but good for landing) */}
        <div className="container mx-auto px-4 py-16">
            <div className="grid md:grid-cols-3 gap-8">
                <div className="bg-white p-6 rounded-xl shadow-sm border">
                    <div className="text-4xl mb-4">⚡️</div>
                    <h3 className="text-xl font-bold mb-2">빠른 문제 제작</h3>
                    <p className="text-gray-600 word-keep-all">
                        긴 지문도 AI가 순식간에 분석하여 다양한 유형의 문제를 생성합니다.
                    </p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border">
                    <div className="text-4xl mb-4">🎯</div>
                    <h3 className="text-xl font-bold mb-2">다양한 유형 지원</h3>
                    <p className="text-gray-600 word-keep-all">
                        빈칸 추론, 어법 수정, 내용 일치 등 내신과 수능에 꼭 필요한 유형을 제공합니다.
                    </p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border">
                    <div className="text-4xl mb-4">📝</div>
                    <h3 className="text-xl font-bold mb-2">편리한 편집/저장</h3>
                    <p className="text-gray-600 word-keep-all">
                        생성된 문제를 수정하고 저장하여 나만의 문제 은행을 구축하세요.
                    </p>
                </div>
            </div>
        </div>
    </div>
  )
}
