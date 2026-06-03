'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  PROMPT_DEFAULT_KEYS,
  type ProblemTypeDefaultPrompt,
  type PromptDefaultKey,
} from '@/lib/ai/problem-type-default-prompts'

type PromptState = {
  prompt_key: PromptDefaultKey
  display_name: string
  description: string
  content: string
  is_enabled: boolean
  sort_order: number
}

interface DefaultPromptSettingsDialogProps {
  initialDefaultPrompts: ProblemTypeDefaultPrompt[]
  workspaceSubject: WorkspaceSubject
}

const buildPromptState = (initialDefaultPrompts: ProblemTypeDefaultPrompt[]): PromptState[] => (
  PROMPT_DEFAULT_KEYS.map((meta) => {
    const prompt = initialDefaultPrompts.find((item) => item.prompt_key === meta.key)

    return {
      prompt_key: meta.key,
      display_name: prompt?.display_name || meta.displayName,
      description: prompt?.description || meta.description,
      content: prompt?.content || meta.fallback,
      is_enabled: prompt?.is_enabled ?? true,
      sort_order: prompt?.sort_order ?? meta.sortOrder,
    }
  })
)

export function DefaultPromptSettingsDialog({
  initialDefaultPrompts,
  workspaceSubject,
}: DefaultPromptSettingsDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [prompts, setPrompts] = useState<PromptState[]>(() => buildPromptState(initialDefaultPrompts))

  useEffect(() => {
    setPrompts(buildPromptState(initialDefaultPrompts))
  }, [initialDefaultPrompts])

  const updatePrompt = (promptKey: PromptDefaultKey, patch: Partial<PromptState>) => {
    setPrompts((current) => current.map((prompt) => (
      prompt.prompt_key === promptKey ? { ...prompt, ...patch } : prompt
    )))
  }

  const handleSave = async () => {
    const emptyPrompt = prompts.find((prompt) => prompt.content.trim().length === 0)
    if (emptyPrompt) {
      toast.error(`${emptyPrompt.display_name} 내용은 비워둘 수 없습니다.`)
      return
    }

    try {
      setSaving(true)
      const response = await fetch(withAdminWorkspaceSubject('/api/admin/problem-type-default-prompts', workspaceSubject), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompts: prompts.map((prompt) => ({
            prompt_key: prompt.prompt_key,
            content: prompt.content,
            is_enabled: prompt.is_enabled,
          })),
        }),
      })
      const result = await response.json()

      if (!response.ok || result.error) {
        throw new Error(result.error || '기본 프롬프트 저장에 실패했습니다.')
      }

      toast.success('기본 프롬프트 설정을 저장했습니다.')
      setOpen(false)
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : '기본 프롬프트 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">기본 프롬프트 관리</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>기본 프롬프트 관리</DialogTitle>
          <DialogDescription>
            새 문제 유형에 자동 적용할 기본 프롬프트와 적용 여부를 관리합니다. 기존 문제 유형의 개별 수정값은 자동으로 덮어쓰지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {prompts.map((prompt) => (
            <div key={prompt.prompt_key} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{prompt.display_name}</h3>
                    <Badge variant={prompt.content.trim() ? (prompt.is_enabled ? 'default' : 'outline') : 'destructive'}>
                      {!prompt.content.trim() ? '내용 없음' : prompt.is_enabled ? '새 유형 기본 적용' : '새 유형 미적용'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{prompt.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={prompt.is_enabled}
                    onCheckedChange={(checked) => updatePrompt(prompt.prompt_key, { is_enabled: checked })}
                    disabled={saving}
                  />
                  <span className="text-xs text-muted-foreground">새 유형에 기본 적용</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`default-${prompt.prompt_key}`}>기본 프롬프트 내용</Label>
                <Textarea
                  id={`default-${prompt.prompt_key}`}
                  className="min-h-[160px] font-mono text-sm"
                  value={prompt.content}
                  onChange={(event) => updatePrompt(prompt.prompt_key, { content: event.target.value })}
                  disabled={saving}
                />
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
