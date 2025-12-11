'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createProblemType } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ModelSelector } from '@/components/admin/model-selector'
import { ProviderSelector } from '@/components/admin/provider-selector'
import { toast } from 'sonner'
import Link from 'next/link'
import { ArrowLeft, Save, FileJson, Copy, Check } from 'lucide-react'

const RESPONSE_STRUCTURE_EXAMPLE = `다음은 문제 생성 API 응답에서 반환해야 하는 JSON 구조입니다.
이 형식에 맞게 응답해주세요.

---
응답 형식 (단일 문제):

{
  "question_text": "문제 본문 텍스트 (필수)",
  "question_text_forward": "passage_text 앞에 표시될 별도의 지문 (선택사항, 없으면 null)",
  "question_text_backward": "passage_text 뒤에 표시될 별도의 지문 (선택사항, 없으면 null)",
  "passage_text": "지문 텍스트 (선택사항, 없으면 null)",
  "choices": [
    { "label": "①", "text": "첫 번째 선택지 내용" },
    { "label": "②", "text": "두 번째 선택지 내용" },
    { "label": "③", "text": "세 번째 선택지 내용" },
    { "label": "④", "text": "네 번째 선택지 내용" },
    { "label": "⑤", "text": "다섯 번째 선택지 내용" }
  ],
  "answer": "정답 (예: ①, ②, ③, ④, ⑤)",
  "explanation": "정답 해설 (선택사항, 없으면 null)",
  "difficulty": "난이도 (Low, Medium, High 중 하나)",
  "grade_level": "학년 (예: Middle1, Middle2, Middle3, High1, High2, High3)"
}

---
choices 필드 규칙:

1. 선택지에 별도 텍스트가 있는 경우:
   "choices": [
     { "label": "①", "text": "선택지 내용 A" },
     { "label": "②", "text": "선택지 내용 B" },
     ...
   ]

2. 선택지가 숫자만 있고, 선택지 내용이 question_text에 포함된 경우:
   (예: 문제 본문에 "① something ② something else..." 형태로 포함)
   "choices": []  // 빈 배열로 설정

---
필드 설명:

| 필드 | 필수 | 타입 | 설명 |
|-----|-----|-----|-----|
| question_text | O | string | 문제 본문 (선택지 번호가 포함될 수 있음) |
| question_text_forward | X | string/null | 지문(passage_text) 앞에 표시될 별도 텍스트 |
| question_text_backward | X | string/null | 지문(passage_text) 뒤에 표시될 별도 텍스트 |
| passage_text | X | string/null | 지문 (장문 읽기 등에 사용) |
| choices | O | array | 선택지 배열 (빈 배열 가능) |
| answer | O | string | 정답 |
| explanation | X | string/null | 해설 |
| difficulty | X | string | 난이도 (Low/Medium/High) |
| grade_level | X | string | 학년 |

---
복수 문제 응답시:

{
  "questions": [
    { /* 위 형식의 문제 객체 1 */ },
    { /* 위 형식의 문제 객체 2 */ },
    ...
  ]
}
`

export default function ProblemTypeFormClient() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [provider, setProvider] = useState('')
  const [modelName, setModelName] = useState('')
  const [copied, setCopied] = useState(false)

  // Provider 변경 시 모델 이름 초기화 (ModelSelector에서 자동으로 첫 번째 모델 선택)
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider)
    setModelName('') // ModelSelector에서 자동으로 첫 번째 모델 선택
  }

  const handleCopyExample = async () => {
    try {
      await navigator.clipboard.writeText(RESPONSE_STRUCTURE_EXAMPLE)
      setCopied(true)
      toast.success("클립보드에 복사되었습니다")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("복사에 실패했습니다")
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    
    if (!provider) {
      toast.error('AI 제공자를 선택해주세요')
      return
    }
    
    if (!modelName) {
      toast.error('모델 이름을 선택해주세요')
      return
    }
    
    try {
      setSaving(true)
      const formData = new FormData(e.currentTarget)
      formData.set('provider', provider)
      formData.set('model_name', modelName)
      const result = await createProblemType(null, formData)
      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success("문제 유형이 생성되었습니다")
        router.push('/admin/problem-types')
      }
    } catch (error) {
      toast.error("생성 중 오류가 발생했습니다")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/problem-types">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">새 문제 유형 생성</h1>
            <p className="text-sm text-gray-500 mt-1">
              AI 프롬프트와 설정을 정의하여 새로운 문제 유형을 만듭니다.
            </p>
          </div>
        </div>
        <Button onClick={() => router.back()} variant="outline">
          취소
        </Button>
      </div>

      {/* Form */}
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle>문제 유형 정보</CardTitle>
          <CardDescription>
            문제 유형의 기본 정보와 AI 설정을 입력하세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type_name">유형 이름 *</Label>
                <Input id="type_name" name="type_name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="is_active">상태</Label>
                <div className="flex items-center space-x-2 h-10">
                  <input type="checkbox" id="is_active" name="is_active" defaultChecked={true} className="h-4 w-4" />
                  <label htmlFor="is_active">활성</label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">설명</Label>
              <Input id="description" name="description" placeholder="문제 유형에 대한 설명을 입력하세요" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="provider">AI 제공자 *</Label>
                <ProviderSelector
                  value={provider}
                  onValueChange={handleProviderChange}
                  required
                />
                <input type="hidden" name="provider" value={provider} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model_name">모델 이름 *</Label>
                <ModelSelector
                  value={modelName}
                  onValueChange={setModelName}
                  provider={provider}
                  required
                />
                <input type="hidden" name="model_name" value={modelName} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt_template">프롬프트 템플릿 *</Label>
              <Textarea 
                id="prompt_template" 
                name="prompt_template" 
                className="font-mono text-sm min-h-[200px]" 
                placeholder="You are an expert... {{PASSAGE}}..." 
                required 
              />
              <p className="text-xs text-gray-500">사용 가능한 변수: {"{{PASSAGE}}, {{GRADE_LEVEL}}, {{DIFFICULTY}}"}</p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Dialog>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline">
                    <FileJson className="h-4 w-4 mr-2" />
                    응답 구조 예시
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>AI 응답 JSON 구조 예시</DialogTitle>
                    <DialogDescription>
                      AI가 문제를 생성할 때 반환해야 하는 JSON 형식입니다. 프롬프트 템플릿에 이 내용을 참고하여 작성하세요.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4">
                    <div className="flex justify-end mb-2">
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        onClick={handleCopyExample}
                      >
                        {copied ? (
                          <>
                            <Check className="h-4 w-4 mr-2" />
                            복사됨
                          </>
                        ) : (
                          <>
                            <Copy className="h-4 w-4 mr-2" />
                            복사
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded-lg text-sm font-mono whitespace-pre-wrap overflow-x-auto">
                      {RESPONSE_STRUCTURE_EXAMPLE}
                    </pre>
                  </div>
                </DialogContent>
              </Dialog>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                취소
              </Button>
              <Button type="submit" disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? '생성 중...' : '생성'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
