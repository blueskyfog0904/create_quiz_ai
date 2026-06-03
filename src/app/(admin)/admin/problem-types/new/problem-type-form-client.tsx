'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { createProblemType } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { Database } from '@/types/supabase'
import {
  DEFAULT_REGENERATION_REQUEST_PROMPT,
  DEFAULT_RESPONSE_STRUCTURE_PROMPT,
  DEFAULT_REVIEW_PROMPT,
  DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT,
} from '@/lib/ai/question-prompts'

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
  "explanation": "정답 해설 (선택사항, 없으면 null)"
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

type DefaultPrompt = Database['public']['Tables']['problem_type_default_prompts']['Row']
type PromptMode = 'default' | 'custom' | 'disabled'
type PromptField =
  | 'output_format'
  | 'review_prompt_template'
  | 'review_output_format'
  | 'regeneration_prompt_template'
type PromptModeField =
  | 'output_format_mode'
  | 'review_prompt_template_mode'
  | 'review_output_format_mode'
  | 'regeneration_prompt_template_mode'

const PROMPT_MODE_OPTIONS: Array<{ value: PromptMode; label: string }> = [
  { value: 'default', label: '기본값 사용' },
  { value: 'custom', label: '개별 수정' },
  { value: 'disabled', label: '미적용' },
]

const PROMPT_FIELD_CONFIGS = [
  {
    field: 'output_format',
    modeField: 'output_format_mode',
    label: '응답 구조 프롬프트',
    fallback: DEFAULT_RESPONSE_STRUCTURE_PROMPT,
  },
  {
    field: 'review_prompt_template',
    modeField: 'review_prompt_template_mode',
    label: '문제 검토 프롬프트',
    fallback: DEFAULT_REVIEW_PROMPT,
  },
  {
    field: 'review_output_format',
    modeField: 'review_output_format_mode',
    label: '검토 후 응답 구조 프롬프트',
    fallback: DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT,
  },
  {
    field: 'regeneration_prompt_template',
    modeField: 'regeneration_prompt_template_mode',
    label: '미통과시 문제생성 요청 프롬프트',
    fallback: DEFAULT_REGENERATION_REQUEST_PROMPT,
  },
] as const

interface ProblemTypeFormClientProps {
  workspaceSubject: WorkspaceSubject
  defaultPrompts: DefaultPrompt[]
}

export default function ProblemTypeFormClient({ workspaceSubject, defaultPrompts }: ProblemTypeFormClientProps) {
  const router = useRouter()
  const getDefaultPrompt = (field: PromptField) => defaultPrompts.find((prompt) => prompt.prompt_key === field)
  const getPromptDefaultValue = (field: PromptField, fallback: string) => getDefaultPrompt(field)?.content || fallback
  const [promptModes, setPromptModes] = useState<Record<PromptModeField, PromptMode>>({
    output_format_mode: getDefaultPrompt('output_format')?.is_enabled === false ? 'disabled' : 'default',
    review_prompt_template_mode: getDefaultPrompt('review_prompt_template')?.is_enabled === false ? 'disabled' : 'default',
    review_output_format_mode: getDefaultPrompt('review_output_format')?.is_enabled === false ? 'disabled' : 'default',
    regeneration_prompt_template_mode: getDefaultPrompt('regeneration_prompt_template')?.is_enabled === false ? 'disabled' : 'default',
  })
  const [promptValues, setPromptValues] = useState<Record<PromptField, string>>({
    output_format: getDefaultPrompt('output_format')?.is_enabled === false
      ? ''
      : getPromptDefaultValue('output_format', DEFAULT_RESPONSE_STRUCTURE_PROMPT),
    review_prompt_template: getDefaultPrompt('review_prompt_template')?.is_enabled === false
      ? ''
      : getPromptDefaultValue('review_prompt_template', DEFAULT_REVIEW_PROMPT),
    review_output_format: getDefaultPrompt('review_output_format')?.is_enabled === false
      ? ''
      : getPromptDefaultValue('review_output_format', DEFAULT_REVIEW_RESPONSE_STRUCTURE_PROMPT),
    regeneration_prompt_template: getDefaultPrompt('regeneration_prompt_template')?.is_enabled === false
      ? ''
      : getPromptDefaultValue('regeneration_prompt_template', DEFAULT_REGENERATION_REQUEST_PROMPT),
  })
  const [saving, setSaving] = useState(false)
  const [generationProvider, setGenerationProvider] = useState('')
  const [generationModelName, setGenerationModelName] = useState('')
  const [reviewProvider, setReviewProvider] = useState('')
  const [reviewModelName, setReviewModelName] = useState('')
  const [copied, setCopied] = useState(false)

  const handleGenerationProviderChange = (newProvider: string) => {
    setGenerationProvider(newProvider)
    setGenerationModelName('')
  }

  const handleReviewProviderChange = (newProvider: string) => {
    setReviewProvider(newProvider)
    setReviewModelName('')
  }

  const handlePromptModeChange = (
    modeField: PromptModeField,
    field: PromptField,
    value: string,
    defaultValue: string
  ) => {
    const nextMode: PromptMode = value === 'default' || value === 'disabled' ? value : 'custom'
    setPromptModes((current) => ({ ...current, [modeField]: nextMode }))

    if (nextMode === 'default') {
      setPromptValues((current) => ({ ...current, [field]: defaultValue }))
    }
    if (nextMode === 'disabled') {
      setPromptValues((current) => ({ ...current, [field]: '' }))
    }
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
    
    if (!generationProvider) {
      toast.error('문제 생성 API 제공자를 선택해주세요')
      return
    }
    
    if (!generationModelName) {
      toast.error('문제 생성 API 모델 이름을 선택해주세요')
      return
    }

    if ((reviewProvider && !reviewModelName) || (!reviewProvider && reviewModelName)) {
      toast.error('문제 검토 API 제공자와 모델은 함께 선택해주세요')
      return
    }

    if (reviewProvider && reviewModelName && (
      promptModes.review_prompt_template_mode === 'disabled' ||
      promptModes.review_output_format_mode === 'disabled'
    )) {
      toast.error('문제 검토 API를 사용하려면 문제 검토 프롬프트와 검토 후 응답구조 프롬프트를 기본값 사용 또는 개별 수정으로 설정해주세요.')
      return
    }
    
    try {
      setSaving(true)
      const formData = new FormData(e.currentTarget)
      formData.set('generation_provider', generationProvider)
      formData.set('generation_model_name', generationModelName)
      formData.set('review_provider', reviewProvider)
      formData.set('review_model_name', reviewModelName)
      const result = await createProblemType(null, formData)
      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success("문제 유형이 생성되었습니다")
        router.push(withAdminWorkspaceSubject('/admin/problem-types', workspaceSubject))
      }
    } catch {
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
          <Link href={withAdminWorkspaceSubject('/admin/problem-types', workspaceSubject)}>
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
            <input type="hidden" name="workspace_subject" value={workspaceSubject} />
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="type_name">유형 이름 *</Label>
                <Input id="type_name" name="type_name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sort_order">번호</Label>
                <Input
                  id="sort_order"
                  name="sort_order"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={0}
                  placeholder="예: 1"
                />
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

            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">문제 생성 API 설정</h3>
                <p className="text-xs text-gray-500 mt-1">문제를 처음 생성하거나 피드백 기반으로 재생성할 때 사용할 모델입니다.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="generation_provider">문제 생성 API 제공자 *</Label>
                  <ProviderSelector
                    value={generationProvider}
                    onValueChange={handleGenerationProviderChange}
                    required
                  />
                  <input type="hidden" name="generation_provider" value={generationProvider} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="generation_model_name">문제 생성 API 모델 이름 *</Label>
                  <ModelSelector
                    value={generationModelName}
                    onValueChange={setGenerationModelName}
                    provider={generationProvider}
                    required
                  />
                  <input type="hidden" name="generation_model_name" value={generationModelName} />
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">문제 검토 API 설정</h3>
                <p className="text-xs text-gray-500 mt-1">생성된 문제를 검토하고 재생성 피드백을 만들 때 사용할 모델입니다.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="review_provider">문제 검토 API 제공자</Label>
                  <ProviderSelector
                    value={reviewProvider}
                    onValueChange={handleReviewProviderChange}
                    allowEmpty
                  />
                  <input type="hidden" name="review_provider" value={reviewProvider} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="review_model_name">문제 검토 API 모델 이름</Label>
                  <ModelSelector
                    value={reviewModelName}
                    onValueChange={setReviewModelName}
                    provider={reviewProvider}
                  />
                  <input type="hidden" name="review_model_name" value={reviewModelName} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prompt_template">문제 생성 프롬프트 *</Label>
              <Textarea 
                id="prompt_template" 
                name="prompt_template" 
                className="font-mono text-sm min-h-[200px]" 
                placeholder="You are an expert... {{PASSAGE}}..." 
                required 
              />
              <p className="text-xs text-gray-500">사용 가능한 변수: {"{{PASSAGE}}, {{GRADE_LEVEL}}, {{DIFFICULTY}}"}</p>
            </div>

            {/* Static source-contract field names: name="output_format" name="review_prompt_template" name="review_output_format" name="regeneration_prompt_template" */}
            {PROMPT_FIELD_CONFIGS.map((config) => {
              const mode = promptModes[config.modeField]
              const defaultValue = getPromptDefaultValue(config.field, config.fallback)

              return (
                <div key={config.field} className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor={config.field}>{config.label}</Label>
                    <Select
                      value={mode}
                      onValueChange={(value) => handlePromptModeChange(config.modeField, config.field, value, defaultValue)}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="적용 방식" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROMPT_MODE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <input type="hidden" name={config.modeField} value={mode} />
                  <Textarea
                    id={config.field}
                    name={config.field}
                    className="font-mono text-sm min-h-[180px]"
                    value={promptValues[config.field]}
                    onChange={(event) => setPromptValues((current) => ({
                      ...current,
                      [config.field]: event.target.value,
                    }))}
                    readOnly={mode !== 'custom'}
                  />
                  <p className="text-xs text-gray-500">
                    {mode === 'default' && '기본 프롬프트를 사용합니다. 기본값 내용은 기본 프롬프트 관리에서 수정할 수 있습니다.'}
                    {mode === 'custom' && '이 유형에만 적용할 프롬프트를 직접 수정합니다.'}
                    {mode === 'disabled' && '이 프롬프트 섹션은 생성/검토 요청에서 제외됩니다.'}
                  </p>
                </div>
              )
            })}

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
