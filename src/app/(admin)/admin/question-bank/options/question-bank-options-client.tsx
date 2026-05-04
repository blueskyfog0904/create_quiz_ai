'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

type QuestionBankYear = {
  id: string
  workspace_subject: string
  year: number
  label: string
  sort_order: number
  is_active: boolean
}

type QuestionBankBook = {
  id: string
  workspace_subject: string
  name: string
  slug: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type YearFormState = {
  year: string
  label: string
  sort_order: string
  is_active: boolean
}

type BookFormState = {
  name: string
  slug: string
  description: string
  sort_order: string
  is_active: boolean
}

const emptyYearForm: YearFormState = {
  year: '',
  label: '',
  sort_order: '0',
  is_active: true,
}

const emptyBookForm: BookFormState = {
  name: '',
  slug: '',
  description: '',
  sort_order: '0',
  is_active: true,
}

interface QuestionBankOptionsClientProps {
  workspaceSubject: WorkspaceSubject
}

function getErrorMessage(status: number, body: { error?: string }) {
  if (status === 409) {
    return body.error ?? '중복된 값이 이미 존재합니다.'
  }

  return body.error ?? '요청 처리에 실패했습니다.'
}

export default function QuestionBankOptionsClient({ workspaceSubject }: QuestionBankOptionsClientProps) {
  const [years, setYears] = useState<QuestionBankYear[]>([])
  const [books, setBooks] = useState<QuestionBankBook[]>([])
  const [yearForm, setYearForm] = useState<YearFormState>(emptyYearForm)
  const [bookForm, setBookForm] = useState<BookFormState>(emptyBookForm)
  const [editingYearId, setEditingYearId] = useState<string | null>(null)
  const [editingBookId, setEditingBookId] = useState<string | null>(null)
  const [yearEditForm, setYearEditForm] = useState<YearFormState>(emptyYearForm)
  const [bookEditForm, setBookEditForm] = useState<BookFormState>(emptyBookForm)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const yearEndpoint = `/api/admin/question-bank/years?subject=${workspaceSubject}`
  const bookEndpoint = `/api/admin/question-bank/books?subject=${workspaceSubject}`

  const loadOptions = async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const [yearResponse, bookResponse] = await Promise.all([
        fetch(yearEndpoint),
        fetch(bookEndpoint),
      ])
      const yearBody = await yearResponse.json()
      const bookBody = await bookResponse.json()

      if (!yearResponse.ok) {
        setErrorMessage(getErrorMessage(yearResponse.status, yearBody))
        return
      }
      if (!bookResponse.ok) {
        setErrorMessage(getErrorMessage(bookResponse.status, bookBody))
        return
      }

      setYears(yearBody.years ?? [])
      setBooks(bookBody.books ?? [])
    } catch (error) {
      setErrorMessage('문제은행 설정을 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadOptions()
  }, [workspaceSubject])

  const saveYear = async (id?: string) => {
    const form = id ? yearEditForm : yearForm
    const payload = {
      workspace_subject: workspaceSubject,
      year: Number(form.year),
      label: form.label,
      sort_order: Number(form.sort_order),
      is_active: form.is_active,
    }
    const response = id
      ? await fetch(`/api/admin/question-bank/years/${id}?subject=${workspaceSubject}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      : await fetch(yearEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    const body = await response.json()

    if (!response.ok) {
      setErrorMessage(getErrorMessage(response.status, body))
      return
    }

    setYearForm(emptyYearForm)
    setEditingYearId(null)
    await loadOptions()
  }

  const saveBook = async (id?: string) => {
    const form = id ? bookEditForm : bookForm
    const payload = {
      workspace_subject: workspaceSubject,
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      sort_order: Number(form.sort_order),
      is_active: form.is_active,
    }
    const response = id
      ? await fetch(`/api/admin/question-bank/books/${id}?subject=${workspaceSubject}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      : await fetch(bookEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    const body = await response.json()

    if (!response.ok) {
      setErrorMessage(getErrorMessage(response.status, body))
      return
    }

    setBookForm(emptyBookForm)
    setEditingBookId(null)
    await loadOptions()
  }

  const deactivateYear = async (id: string) => {
    const response = await fetch(`/api/admin/question-bank/years/${id}?subject=${workspaceSubject}`, {
      method: 'DELETE',
    })
    const body = await response.json()

    if (!response.ok) {
      setErrorMessage(getErrorMessage(response.status, body))
      return
    }

    await loadOptions()
  }

  const deactivateBook = async (id: string) => {
    const response = await fetch(`/api/admin/question-bank/books/${id}?subject=${workspaceSubject}`, {
      method: 'DELETE',
    })
    const body = await response.json()

    if (!response.ok) {
      setErrorMessage(getErrorMessage(response.status, body))
      return
    }

    await loadOptions()
  }

  const startYearEdit = (year: QuestionBankYear) => {
    setEditingYearId(year.id)
    setYearEditForm({
      year: String(year.year),
      label: year.label,
      sort_order: String(year.sort_order),
      is_active: year.is_active,
    })
  }

  const startBookEdit = (book: QuestionBankBook) => {
    setEditingBookId(book.id)
    setBookEditForm({
      name: book.name,
      slug: book.slug,
      description: book.description ?? '',
      sort_order: String(book.sort_order),
      is_active: book.is_active,
    })
  }

  const cancelYearEdit = () => {
    setEditingYearId(null)
    setYearEditForm(emptyYearForm)
  }

  const cancelBookEdit = () => {
    setEditingBookId(null)
    setBookEditForm(emptyBookForm)
  }

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>연도 설정</CardTitle>
          <CardDescription>문제은행에서 사용할 연도 옵션을 추가, 수정, 비활성화합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <div className="space-y-1">
              <Label htmlFor="new-year">연도</Label>
              <Input id="new-year" value={yearForm.year} onChange={(event) => setYearForm({ ...yearForm, year: event.target.value })} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="new-year-label">라벨</Label>
              <Input id="new-year-label" value={yearForm.label} onChange={(event) => setYearForm({ ...yearForm, label: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-year-sort">정렬</Label>
              <Input id="new-year-sort" value={yearForm.sort_order} onChange={(event) => setYearForm({ ...yearForm, sort_order: event.target.value })} />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={yearForm.is_active} onChange={(event) => setYearForm({ ...yearForm, is_active: event.target.checked })} />
                활성
              </label>
              <Button type="button" onClick={() => saveYear()}>연도 추가</Button>
            </div>
          </div>

          <div className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">불러오는 중입니다.</p>
            ) : years.map((year) => (
              <div key={year.id} className="rounded-md border p-3">
                {editingYearId === year.id ? (
                  <div className="grid gap-3 md:grid-cols-5">
                    <Input value={yearEditForm.year} onChange={(event) => setYearEditForm({ ...yearEditForm, year: event.target.value })} />
                    <Input className="md:col-span-2" value={yearEditForm.label} onChange={(event) => setYearEditForm({ ...yearEditForm, label: event.target.value })} />
                    <Input value={yearEditForm.sort_order} onChange={(event) => setYearEditForm({ ...yearEditForm, sort_order: event.target.value })} />
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={yearEditForm.is_active} onChange={(event) => setYearEditForm({ ...yearEditForm, is_active: event.target.checked })} />
                        활성
                      </label>
                      <Button type="button" size="sm" onClick={() => saveYear(year.id)}>저장</Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelYearEdit}>취소</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{year.label} ({year.year})</div>
                      <div className="text-sm text-muted-foreground">정렬 {year.sort_order} · {year.is_active ? '활성' : '비활성'}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => startYearEdit(year)}>수정</Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => deactivateYear(year.id)}>비활성화</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>교재 설정</CardTitle>
          <CardDescription>문제은행에서 사용할 교재 옵션을 추가, 수정, 비활성화합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="new-book-name">교재명</Label>
              <Input id="new-book-name" value={bookForm.name} onChange={(event) => setBookForm({ ...bookForm, name: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-book-slug">슬러그</Label>
              <Input id="new-book-slug" value={bookForm.slug} onChange={(event) => setBookForm({ ...bookForm, slug: event.target.value })} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="new-book-description">설명</Label>
              <Input id="new-book-description" value={bookForm.description} onChange={(event) => setBookForm({ ...bookForm, description: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-book-sort">정렬</Label>
              <Input id="new-book-sort" value={bookForm.sort_order} onChange={(event) => setBookForm({ ...bookForm, sort_order: event.target.value })} />
            </div>
            <div className="flex items-center gap-2 md:col-span-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={bookForm.is_active} onChange={(event) => setBookForm({ ...bookForm, is_active: event.target.checked })} />
                활성
              </label>
              <Button type="button" onClick={() => saveBook()}>교재 추가</Button>
            </div>
          </div>

          <div className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">불러오는 중입니다.</p>
            ) : books.map((book) => (
              <div key={book.id} className="rounded-md border p-3">
                {editingBookId === book.id ? (
                  <div className="grid gap-3 md:grid-cols-6">
                    <Input className="md:col-span-2" value={bookEditForm.name} onChange={(event) => setBookEditForm({ ...bookEditForm, name: event.target.value })} />
                    <Input value={bookEditForm.slug} onChange={(event) => setBookEditForm({ ...bookEditForm, slug: event.target.value })} />
                    <Input className="md:col-span-2" value={bookEditForm.description} onChange={(event) => setBookEditForm({ ...bookEditForm, description: event.target.value })} />
                    <Input value={bookEditForm.sort_order} onChange={(event) => setBookEditForm({ ...bookEditForm, sort_order: event.target.value })} />
                    <div className="flex items-center gap-2 md:col-span-6">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={bookEditForm.is_active} onChange={(event) => setBookEditForm({ ...bookEditForm, is_active: event.target.checked })} />
                        활성
                      </label>
                      <Button type="button" size="sm" onClick={() => saveBook(book.id)}>저장</Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelBookEdit}>취소</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">{book.name}</div>
                      <div className="text-sm text-muted-foreground">{book.slug} · 정렬 {book.sort_order} · {book.is_active ? '활성' : '비활성'}</div>
                      {book.description && <div className="text-sm text-muted-foreground">{book.description}</div>}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => startBookEdit(book)}>수정</Button>
                      <Button type="button" size="sm" variant="destructive" onClick={() => deactivateBook(book.id)}>비활성화</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
