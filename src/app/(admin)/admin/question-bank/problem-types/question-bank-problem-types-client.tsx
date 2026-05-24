'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

type QuestionBankProblemType = {
  id: string
  workspace_subject: string
  type_name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type ProblemTypeFormState = {
  type_name: string
  description: string
  sort_order: string
  is_active: boolean
}

const emptyForm: ProblemTypeFormState = {
  type_name: '',
  description: '',
  sort_order: '0',
  is_active: true,
}

interface QuestionBankProblemTypesClientProps {
  workspaceSubject: WorkspaceSubject
}

function getErrorMessage(status: number, body: { error?: string }) {
  if (status === 409) {
    return body.error ?? '중복된 문제유형이 이미 존재합니다.'
  }

  return body.error ?? '요청 처리에 실패했습니다.'
}

export default function QuestionBankProblemTypesClient({ workspaceSubject }: QuestionBankProblemTypesClientProps) {
  const [problemTypes, setProblemTypes] = useState<QuestionBankProblemType[]>([])
  const [form, setForm] = useState<ProblemTypeFormState>(emptyForm)
  const [editForm, setEditForm] = useState<ProblemTypeFormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const endpoint = `/api/admin/question-bank/problem-types?subject=${workspaceSubject}`

  const loadProblemTypes = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const response = await fetch(endpoint)
      const body = await response.json()

      if (!response.ok) {
        setErrorMessage(getErrorMessage(response.status, body))
        return
      }

      setProblemTypes(body.problemTypes ?? [])
    } catch {
      setErrorMessage('문제은행 문제유형을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    loadProblemTypes()
  }, [loadProblemTypes])

  const saveProblemType = async (id?: string) => {
    const currentForm = id ? editForm : form
    const payload = {
      workspace_subject: workspaceSubject,
      type_name: currentForm.type_name,
      description: currentForm.description || null,
      sort_order: Number(currentForm.sort_order),
      is_active: currentForm.is_active,
    }
    const response = id
      ? await fetch(`/api/admin/question-bank/problem-types/${id}?subject=${workspaceSubject}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      : await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    const body = await response.json()

    if (!response.ok) {
      setErrorMessage(getErrorMessage(response.status, body))
      return
    }

    setForm(emptyForm)
    setEditForm(emptyForm)
    setEditingId(null)
    await loadProblemTypes()
  }

  const deactivateProblemType = async (id: string) => {
    const response = await fetch(`/api/admin/question-bank/problem-types/${id}?subject=${workspaceSubject}`, {
      method: 'DELETE',
    })
    const body = await response.json()

    if (!response.ok) {
      setErrorMessage(getErrorMessage(response.status, body))
      return
    }

    await loadProblemTypes()
  }

  const startEdit = (problemType: QuestionBankProblemType) => {
    setEditingId(problemType.id)
    setEditForm({
      type_name: problemType.type_name,
      description: problemType.description ?? '',
      sort_order: String(problemType.sort_order),
      is_active: problemType.is_active,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm(emptyForm)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>문제은행 문제유형</CardTitle>
        <CardDescription>
          문제 업로드, 문제은행 필터, 랜덤 문제지 생성에서 사용할 유형을 추가, 수정, 비활성화합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-5">
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="new-bank-type-name">유형명</Label>
            <Input id="new-bank-type-name" value={form.type_name} onChange={(event) => setForm({ ...form, type_name: event.target.value })} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="new-bank-type-description">설명</Label>
            <Input id="new-bank-type-description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-bank-type-sort">정렬</Label>
            <Input id="new-bank-type-sort" value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} />
          </div>
          <div className="flex items-center gap-2 md:col-span-5">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
              활성
            </label>
            <Button type="button" onClick={() => saveProblemType()} disabled={!form.type_name.trim()}>문제유형 추가</Button>
          </div>
        </div>

        <div className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">불러오는 중입니다.</p>
          ) : problemTypes.map((problemType) => (
            <div key={problemType.id} className="rounded-md border p-3">
              {editingId === problemType.id ? (
                <div className="grid gap-3 md:grid-cols-5">
                  <Input className="md:col-span-2" value={editForm.type_name} onChange={(event) => setEditForm({ ...editForm, type_name: event.target.value })} />
                  <Input className="md:col-span-2" value={editForm.description} onChange={(event) => setEditForm({ ...editForm, description: event.target.value })} />
                  <Input value={editForm.sort_order} onChange={(event) => setEditForm({ ...editForm, sort_order: event.target.value })} />
                  <div className="flex items-center gap-2 md:col-span-5">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={editForm.is_active} onChange={(event) => setEditForm({ ...editForm, is_active: event.target.checked })} />
                      활성
                    </label>
                    <Button type="button" size="sm" onClick={() => saveProblemType(problemType.id)} disabled={!editForm.type_name.trim()}>저장</Button>
                    <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>취소</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{problemType.type_name}</div>
                    <div className="text-sm text-muted-foreground">정렬 {problemType.sort_order} · {problemType.is_active ? '활성' : '비활성'}</div>
                    {problemType.description && <div className="text-sm text-muted-foreground">{problemType.description}</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(problemType)}>수정</Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => deactivateProblemType(problemType.id)}>비활성화</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
