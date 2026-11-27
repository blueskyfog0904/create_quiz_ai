'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SiteBoardPostBody, formatSiteBoardDate } from '@/components/site-board/site-board-post-body'
import { MEMBER_FACING_PII_LABELS, memberFacingTextPiiHits } from '@/lib/member-facing-text-pii'
import {
  SITE_BOARD_BODY_MAX,
  decodeSiteBoardLinkForPii,
  SITE_BOARD_REQUIRED_KEYS,
  SITE_BOARD_TITLE_MAX,
  noticePath,
  type SiteBoardAdminPost,
  type SiteBoardContent,
  type SiteBoardKind,
  type SiteBoardPostInput,
} from '@/lib/site-board'
import type { SiteBoardAdminData } from '@/lib/site-board-server'
import {
  deleteSiteBoardPostAction,
  redactSiteBoardPostAction,
  reorderSiteBoardPostsAction,
  saveSiteBoardContentAction,
  saveSiteBoardPostAction,
  type SiteBoardActionResult,
} from './actions'

// 14번 7절: 공지사항·자주 묻는 질문 관리 부품 하나(board 인자). 관리자 안내 문구는 코드 글자, 회원 화면 문구는 '안내 문구' 탭(DB).
// localhost 도 운영 DB 를 쓴다 — 로컬 확인 때는 저장·삭제·순서 저장·가림을 누르지 않는다(미리보기 스위치에서는 서버가 막는다).

interface BoardAdminProps {
  data: SiteBoardAdminData
  canRedact: boolean
  piiAllowed: { customerCenter: string; orderEmail: string }
  // 16번: 공지 알림 보내기(대표만)와 글마다 보낸(회수하지 않은) 공지 알림 수(null = 확인 못 함). FAQ 화면은 넘기지 않는다.
  canBroadcast?: boolean
  linkedBroadcasts?: Record<string, number> | null
}

const BOARD_TITLES: Record<SiteBoardKind, string> = { notice: '공지사항', faq: '자주 묻는 질문' }

// 안내 문구 탭의 칸 이름(관리자 안내)
const CONTENT_FIELD_LABELS: Record<string, string> = {
  pageTitle: '화면 제목',
  pageDescription: '화면 설명',
  emptyTitle: '글이 없을 때 제목',
  emptyDescription: '글이 없을 때 설명',
  pinnedLabel: '고정 글 머리표',
  updatedLabel: '수정 날짜 앞 글',
  backToListLabel: '목록으로 버튼',
  notFoundTitle: '없는 글 제목',
  notFoundDescription: '없는 글 설명',
  footerLinkLabel: '하단 링크 이름',
  allCategoryLabel: '전체 탭 이름',
  supportPrompt: '1:1 문의 안내',
  supportLinkLabel: '1:1 문의 링크 이름',
  navLabel: '하단 링크 묶음 이름(화면 읽기 프로그램용)',
}

interface EditorState {
  post: SiteBoardAdminPost | null
  input: SiteBoardPostInput
}

type ConfirmState =
  | { kind: 'hide'; post: SiteBoardAdminPost; input: SiteBoardPostInput }
  | { kind: 'delete'; post: SiteBoardAdminPost }
  | { kind: 'redact'; post: SiteBoardAdminPost }
  | null

function emptyInput(board: SiteBoardKind, content: SiteBoardContent): SiteBoardPostInput {
  return {
    title: '',
    body: '',
    linkUrl: null,
    linkLabel: null,
    faqCategoryKey: board === 'faq' ? content.faq.categories[0]?.key ?? null : null,
    isPinned: false,
    isPublished: false,
  }
}

function inputOf(post: SiteBoardAdminPost): SiteBoardPostInput {
  return {
    title: post.title,
    body: post.body,
    linkUrl: post.linkUrl,
    linkLabel: post.linkLabel,
    faqCategoryKey: post.faqCategoryKey,
    isPinned: post.isPinned,
    isPublished: post.isPublished,
  }
}

function statusLabel(post: SiteBoardAdminPost) {
  if (post.deletedAt) return post.redactedAt ? '삭제·가림' : '삭제'
  if (post.redactedAt) return '가림'
  return post.isPublished ? '게시' : '숨김'
}

// 순서 묶음(5-5): 공지는 미삭제 고정 글(숨김 포함), FAQ 는 분류마다 미삭제 글(숨김 포함).
function orderGroups(board: SiteBoardKind, posts: SiteBoardAdminPost[], content: SiteBoardContent) {
  const sorted = (items: SiteBoardAdminPost[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
  if (board === 'notice') {
    return [{ scope: 'pinned', label: '고정 공지', posts: sorted(posts.filter((post) => post.isPinned)) }]
  }
  const groups = content.faq.categories.map((category) => ({
    scope: category.key,
    label: category.label,
    posts: sorted(posts.filter((post) => post.faqCategoryKey === category.key)),
  }))
  return groups.filter((group) => group.posts.length > 0)
}

export function BoardAdmin({ data, canRedact, piiAllowed, canBroadcast = false, linkedBroadcasts }: BoardAdminProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [orders, setOrders] = useState<Record<string, string[]> | null>(null)
  const board = data.board
  const categoryLabel = (key: string | null) => data.content.faq.categories.find((category) => category.key === key)?.label ?? key ?? ''
  const groups = useMemo(() => orderGroups(board, data.posts, data.content), [board, data.posts, data.content])
  const postById = useMemo(() => new Map([...data.posts, ...data.deletedPosts].map((post) => [post.id, post])), [data.posts, data.deletedPosts])
  const pinnedCount = useMemo(() => data.posts.filter((post) => post.board === 'notice' && post.isPinned).length, [data.posts])

  const handleResult = (result: SiteBoardActionResult, success: string) => {
    if (result.ok) {
      toast.success(result.changed ? success : '바뀐 것이 없습니다.')
      return true
    }
    toast.error(result.error)
    // 판 충돌·순서 불일치면 최신 값을 다시 읽는다. 열린 편집 창·확인 창은 옛 판을 들고 있어 다시 눌러도 충돌하므로 닫는다
    // (안내 문구: '글을 다시 열어 확인한 뒤 저장하세요').
    if (result.conflict) {
      setOrders(null)
      setEditor(null)
      setConfirm(null)
      router.refresh()
    }
    return false
  }

  const openEditor = (post: SiteBoardAdminPost | null) => {
    setShowPreview(false)
    setEditor({ post, input: post ? inputOf(post) : emptyInput(board, data.content) })
  }
  const updateInput = (patch: Partial<SiteBoardPostInput>) => setEditor((current) => (current ? { ...current, input: { ...current.input, ...patch } } : current))

  const runSave = (post: SiteBoardAdminPost | null, input: SiteBoardPostInput) => {
    startTransition(async () => {
      const result = await saveSiteBoardPostAction(board, post?.id ?? null, post?.revision ?? null, input)
      if (handleResult(result, '저장했습니다.')) {
        setEditor(null)
        setConfirm(null)
        // 고정·삭제가 바뀌면 순서 묶음도 바뀐다 — 저장 전 바꿔 둔 순서는 버린다.
        setOrders(null)
        router.refresh()
      }
    })
  }

  const submitEditor = () => {
    if (!editor) return
    // 게시 중인 글을 숨기면 확인 창(팝업 연결 경고 포함)
    if (editor.post?.isPublished && !editor.input.isPublished) {
      setConfirm({ kind: 'hide', post: editor.post, input: editor.input })
      return
    }
    runSave(editor.post, editor.input)
  }

  const runDelete = (post: SiteBoardAdminPost) => {
    startTransition(async () => {
      const result = await deleteSiteBoardPostAction(board, post.id, post.revision)
      if (handleResult(result, '삭제했습니다. 기록에는 남습니다.')) {
        setEditor(null)
        setConfirm(null)
        setOrders(null)
        router.refresh()
      }
    })
  }

  const runRedact = (post: SiteBoardAdminPost) => {
    startTransition(async () => {
      const result = await redactSiteBoardPostAction(board, post.id, 'pii')
      if (handleResult(result, '모든 판의 제목·본문을 가렸습니다.')) {
        setEditor(null)
        setConfirm(null)
        setOrders(null)
        router.refresh()
      }
    })
  }

  const currentOrder = (scope: string, fallback: SiteBoardAdminPost[]) => orders?.[scope] ?? fallback.map((post) => post.id)
  const move = (scope: string, fallback: SiteBoardAdminPost[], index: number, delta: number) => {
    const ids = [...currentOrder(scope, fallback)]
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    setOrders((current) => ({ ...(current ?? {}), [scope]: ids }))
  }
  const saveOrder = (scope: string, fallback: SiteBoardAdminPost[]) => {
    const ids = currentOrder(scope, fallback)
    startTransition(async () => {
      const result = await reorderSiteBoardPostsAction(board, scope, ids)
      if (handleResult(result, '순서를 저장했습니다.')) {
        setOrders((current) => {
          if (!current) return current
          const next = { ...current }
          delete next[scope]
          return next
        })
        router.refresh()
      }
    })
  }

  const popupLinked = (post: SiteBoardAdminPost | null) => Boolean(post && board === 'notice' && data.popupLinkedPostId === post.id)
  const editorHits = editor
    ? memberFacingTextPiiHits([editor.input.title, editor.input.body, editor.input.linkUrl ?? '', decodeSiteBoardLinkForPii(editor.input.linkUrl ?? ''),
        editor.input.linkLabel ?? ''].join('\n'), piiAllowed)
    : []

  const copyAddress = async (post: SiteBoardAdminPost) => {
    try {
      await navigator.clipboard.writeText(noticePath(post.id))
      toast.success('주소를 복사했습니다.')
    } catch {
      toast.error('주소를 복사하지 못했습니다. 직접 선택해 복사해 주세요.')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{BOARD_TITLES[board]}</h1>
        <p className="mt-1 text-sm text-gray-500">
          회원 화면 {board === 'notice' ? '/notices' : '/faq'} 에 보이는 글을 쓰고 고칩니다. 저장·삭제·순서·가림은 모두 작업 기록에 남습니다(글 원문은 판 이력에만).
        </p>
        {data.preview ? (
          <p role="note" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            개발 미리보기입니다. 예시 글을 메모리에서 그리며, 저장 버튼을 눌러도 운영 DB 에 쓰지 않습니다.
          </p>
        ) : null}
      </div>

      <Tabs defaultValue="posts">
        <TabsList>
          <TabsTrigger value="posts">글</TabsTrigger>
          <TabsTrigger value="content">안내 문구</TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>글 목록</CardTitle>
                <CardDescription>
                  {board === 'notice'
                    ? `고정 글은 회원 목록 맨 위에 보입니다(숨긴 고정 글 포함 최대 ${data.content.notice.maxPinned}개).`
                    : '분류마다 정한 순서로 회원 화면에 보입니다. 숨긴 글도 순서 묶음에 함께 보입니다.'}
                </CardDescription>
              </div>
              <Button variant="brandOutline" onClick={() => openEditor(null)} disabled={pending}>
                <Plus /> 새 글
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.posts.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">아직 글이 없습니다.</p>
              ) : (
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b text-left text-xs text-gray-500">
                    <tr>
                      <th className="py-2 pr-3">상태</th>
                      <th className="py-2 pr-3">{board === 'notice' ? '고정' : '분류'}</th>
                      <th className="py-2 pr-3">제목</th>
                      <th className="py-2 pr-3">게시일·수정일</th>
                      <th className="py-2 pr-3">마지막 수정자</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.posts.map((post) => (
                      <tr key={post.id} className="border-b last:border-b-0">
                        <td className="py-2 pr-3"><Badge variant={post.isPublished ? 'default' : 'secondary'}>{statusLabel(post)}</Badge></td>
                        <td className="py-2 pr-3">{board === 'notice' ? (post.isPinned ? '고정' : '') : categoryLabel(post.faqCategoryKey)}</td>
                        <td className="max-w-[320px] truncate py-2 pr-3" title={post.title}>
                          {post.title}
                          {popupLinked(post) ? <span className="ml-2 text-xs font-semibold text-orange-700">팝업 연결</span> : null}
                        </td>
                        <td className="py-2 pr-3 text-xs text-gray-600">
                          {formatSiteBoardDate(post.publishedAt) || '-'}
                          {post.contentUpdatedAt ? ` · 수정 ${formatSiteBoardDate(post.contentUpdatedAt)}` : ''}
                        </td>
                        <td className="py-2 pr-3 text-xs text-gray-600">{post.updatedByLabel ?? '-'}</td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="adminTable" onClick={() => openEditor(post)} disabled={pending || Boolean(post.redactedAt)}>편집</Button>
                            <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: 'delete', post })} disabled={pending}>삭제</Button>
                            {canRedact && !post.isPublished && !post.redactedAt ? (
                              <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: 'redact', post })} disabled={pending}>가림</Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {groups.map((group) => {
            const ids = currentOrder(group.scope, group.posts)
            const dirty = Boolean(orders?.[group.scope])
            return (
              <Card key={group.scope}>
                <CardHeader>
                  <CardTitle>{group.label} 순서</CardTitle>
                  <CardDescription>[위로]·[아래로]로 바꾼 뒤 [순서 저장]을 누르세요. 그 사이 목록이 바뀌면 다시 불러옵니다.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <ol className="space-y-1">
                    {ids.map((id, index) => {
                      const post = postById.get(id)
                      if (!post) return null
                      return (
                        <li key={id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                          <span className="w-6 text-gray-500">{index + 1}</span>
                          <span className="min-w-0 flex-1 truncate">{post.title}</span>
                          {!post.isPublished ? <Badge variant="secondary">숨김</Badge> : null}
                          <Button size="icon-sm" variant="outline" aria-label="위로" onClick={() => move(group.scope, group.posts, index, -1)} disabled={pending || index === 0}>
                            <ArrowUp />
                          </Button>
                          <Button size="icon-sm" variant="outline" aria-label="아래로" onClick={() => move(group.scope, group.posts, index, 1)} disabled={pending || index === ids.length - 1}>
                            <ArrowDown />
                          </Button>
                        </li>
                      )
                    })}
                  </ol>
                  <div className="flex justify-end">
                    <Button onClick={() => saveOrder(group.scope, group.posts)} disabled={pending || !dirty}>순서 저장</Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}

          {data.deletedPosts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>삭제한 글</CardTitle>
                <CardDescription>회원 화면에 보이지 않습니다. 개인정보가 들어간 글은 대표가 [가림]으로 모든 판의 제목·본문을 가립니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {data.deletedPosts.map((post) => (
                    <li key={post.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                      <Badge variant="secondary">{statusLabel(post)}</Badge>
                      <span className="min-w-0 flex-1 truncate">{post.title}</span>
                      {canRedact && !post.redactedAt ? (
                        <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: 'redact', post })} disabled={pending}>가림</Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="content">
          <BoardContentEditor
            key={data.content.revision}
            board={board}
            content={data.content}
            pinnedCount={pinnedCount}
            piiAllowed={piiAllowed}
            onSaved={() => router.refresh()}
            onResult={handleResult}
          />
        </TabsContent>
      </Tabs>

      <Sheet open={editor !== null} onOpenChange={(open) => { if (!open && !pending) setEditor(null) }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          {editor ? (
            <>
              <SheetHeader>
                <SheetTitle>{editor.post ? '글 편집' : '새 글'}</SheetTitle>
                <SheetDescription>서식 없는 글입니다: 빈 줄로 문단, &lsquo;- &rsquo;로 목록, &lsquo;## &rsquo;로 소제목. 이미지·첨부·HTML 은 넣지 않습니다.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="space-y-1">
                  <Label htmlFor="site-board-title">제목</Label>
                  <Input id="site-board-title" value={editor.input.title} maxLength={SITE_BOARD_TITLE_MAX} onChange={(event) => updateInput({ title: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="site-board-body">본문 <span className="text-xs text-gray-500">({Array.from(editor.input.body).length}/{SITE_BOARD_BODY_MAX})</span></Label>
                  <Textarea id="site-board-body" rows={12} value={editor.input.body} onChange={(event) => updateInput({ body: event.target.value })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="site-board-link">링크 주소(선택, /로 시작)</Label>
                    <Input id="site-board-link" value={editor.input.linkUrl ?? ''} placeholder="/terms/upcoming" onChange={(event) => updateInput({ linkUrl: event.target.value || null })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="site-board-link-label">링크 이름</Label>
                    <Input id="site-board-link-label" value={editor.input.linkLabel ?? ''} onChange={(event) => updateInput({ linkLabel: event.target.value || null })} />
                  </div>
                </div>
                {board === 'faq' ? (
                  <div className="space-y-1">
                    <Label htmlFor="site-board-category">분류</Label>
                    <select
                      id="site-board-category"
                      className="h-9 w-full rounded-md border px-3 text-sm"
                      value={editor.input.faqCategoryKey ?? ''}
                      onChange={(event) => updateInput({ faqCategoryKey: event.target.value || null })}
                    >
                      {data.content.faq.categories.map((category) => (
                        <option key={category.key} value={category.key}>{category.label}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={editor.input.isPinned} onCheckedChange={(checked) => updateInput({ isPinned: checked })} /> 고정(목록 맨 위)
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={editor.input.isPublished} onCheckedChange={(checked) => updateInput({ isPublished: checked })} /> 회원 화면에 게시
                </label>

                {editorHits.length > 0 ? (
                  <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                    개인정보로 보이는 글이 있습니다({editorHits.map((kind) => MEMBER_FACING_PII_LABELS[kind]).join(', ')}). 고객센터 연락처 말고는 적지 마세요. 저장하면 거절됩니다.
                  </p>
                ) : null}

                {board === 'notice' && editor.post?.isPublished ? (
                  <div className={`space-y-2 rounded-md px-3 py-2 text-sm ${data.noticePeriod ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-700'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-white px-2 py-1 text-xs">{noticePath(editor.post.id)}</code>
                      <Button size="sm" variant="adminTable" onClick={() => editor.post && void copyAddress(editor.post)}>주소 복사</Button>
                    </div>
                    <p>공지 팝업 링크로 쓸 수 있습니다. 약관 변경 고지 기간에는 팝업 링크를 바꾸지 마세요.</p>
                    {popupLinked(editor.post) ? <p className="font-semibold text-orange-800">지금 공지 팝업이 이 글로 연결됩니다.</p> : null}
                    {/* 16번 7-3: 게시 중인 저장된 공지로 공지 알림 보내기(대표만) — '알림' 화면의 보내기 탭을 이 글로 채워 연다 */}
                    {canBroadcast ? (
                      <Button size="sm" variant="adminTable" asChild>
                        <Link href={`/admin/notifications?tab=broadcast&postId=${editor.post.id}`}>이 공지로 알림 보내기</Link>
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                  <Button variant="outline" onClick={() => setShowPreview((value) => !value)}>{showPreview ? '미리보기 닫기' : '미리보기'}</Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setEditor(null)} disabled={pending}>취소</Button>
                    <Button onClick={submitEditor} disabled={pending}>저장</Button>
                  </div>
                </div>
                {showPreview ? (
                  <div className="rounded-lg border p-4">
                    <p className="mb-3 text-xs font-semibold text-gray-500">회원 화면 미리보기(저장하지 않음)</p>
                    <h2 className="mb-4 text-xl font-bold">{editor.input.title}</h2>
                    <SiteBoardPostBody body={editor.input.body} linkUrl={editor.input.linkUrl} linkLabel={editor.input.linkLabel} />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open && !pending) setConfirm(null) }}>
        <AlertDialogContent>
          {confirm ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm.kind === 'hide' ? '이 글을 숨길까요?' : confirm.kind === 'delete' ? '이 글을 삭제할까요?' : '이 글을 가릴까요?'}
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2 text-left leading-6">
                  {confirm.kind === 'redact' ? (
                    <span className="block">이 글의 모든 판에서 제목·본문이 가림 문구로 바뀌고 링크가 지워지며 되돌릴 수 없습니다.</span>
                  ) : (
                    <span className="block">회원 화면에서 사라집니다. 기록에는 남습니다.</span>
                  )}
                  {confirm.kind !== 'redact' && popupLinked(confirm.post) ? (
                    <span className="block font-semibold text-red-700">
                      지금 공지 팝업 버튼이 이 글로 연결됩니다. 숨기면 팝업 버튼이 끊깁니다. 먼저 팝업 링크를 바꾸세요.
                    </span>
                  ) : null}
                  {confirm.kind !== 'redact' && board === 'notice' && data.popupCheckFailed ? (
                    <span className="block font-semibold text-amber-800">
                      공지 팝업 연결을 확인하지 못했습니다. 팝업 링크가 이 글을 가리키는지 먼저 확인하세요.
                    </span>
                  ) : null}
                  {/* 16번 연결점(7-3) — 16번 3절 '넣는 것': 이 글로 보낸 공지 알림이 있으면 숨김·삭제 확인 창에 경고, 가림 확인 창에 회수·가림 안내(같은 조회) */}
                  {board === 'notice' && linkedBroadcasts !== undefined ? (
                    linkedBroadcasts === null ? (
                      <span className="block font-semibold text-amber-800">이 글로 보낸 공지 알림을 확인하지 못했습니다.</span>
                    ) : (linkedBroadcasts[confirm.post.id] ?? 0) > 0 ? (
                      confirm.kind === 'redact' ? (
                        <span className="block font-semibold text-red-700">
                          이 글로 보낸 공지 알림도 &apos;알림&apos; 화면에서 [회수](개인정보, 가림 포함)하세요.
                        </span>
                      ) : (
                        <span className="block font-semibold text-red-700">
                          이 글로 보낸 공지 알림이 {linkedBroadcasts[confirm.post.id]}건 있습니다. 숨기면 알림 링크가 없는 글 화면으로 갑니다. 필요하면 &apos;알림&apos; 화면에서 [회수]하세요.
                        </span>
                      )
                    ) : null
                  ) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>취소</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    if (confirm.kind === 'hide') runSave(confirm.post, confirm.input)
                    else if (confirm.kind === 'delete') runDelete(confirm.post)
                    else runRedact(confirm.post)
                  }}
                >
                  {confirm.kind === 'hide' ? '숨기기' : confirm.kind === 'delete' ? '삭제' : '가림'}
                </Button>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ── 안내 문구 탭(7-4): 이 게시판 문구 + 함께 쓰는 문구(하단 묶음 이름·가림 문구). 저장하면 설정 행 전체를 보낸다. ─────────────
function BoardContentEditor({
  board,
  content,
  pinnedCount,
  piiAllowed,
  onSaved,
  onResult,
}: {
  board: SiteBoardKind
  content: SiteBoardContent
  pinnedCount: number
  piiAllowed: BoardAdminProps['piiAllowed']
  onSaved: () => void
  onResult: (result: SiteBoardActionResult, success: string) => boolean
}) {
  const [pending, startTransition] = useTransition()
  const [value, setValue] = useState<Omit<SiteBoardContent, 'revision'>>(() => ({
    notice: { ...content.notice },
    faq: { ...content.faq, categories: content.faq.categories.map((category) => ({ ...category })) },
    footer: { ...content.footer },
    redactedText: content.redactedText,
  }))
  const section = board === 'notice' ? value.notice : value.faq
  const keys: readonly string[] = SITE_BOARD_REQUIRED_KEYS[board]
  const setSection = (key: string, text: string) =>
    setValue((current) => (board === 'notice'
      ? { ...current, notice: { ...current.notice, [key]: text } }
      : { ...current, faq: { ...current.faq, [key]: text } }))
  const setCategories = (categories: SiteBoardContent['faq']['categories']) => setValue((current) => ({ ...current, faq: { ...current.faq, categories } }))
  const hits = memberFacingTextPiiHits(
    [...Object.values(value.notice), ...Object.values(value.faq).filter((item) => typeof item === 'string'),
      ...value.faq.categories.map((category) => category.label), value.footer.navLabel, value.redactedText].join('\n'),
    piiAllowed
  )

  const save = () => {
    startTransition(async () => {
      const result = await saveSiteBoardContentAction(content.revision, value, pinnedCount)
      if (onResult(result, '안내 문구를 저장했습니다.')) onSaved()
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>안내 문구</CardTitle>
        <CardDescription>
          회원 화면에 보이는 문구입니다(초안 — 대표가 확정). 공지사항·자주 묻는 질문 화면이 같은 설정을 함께 저장합니다. 개인정보는 적지 마세요.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {keys.map((key) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`site-board-content-${key}`}>{CONTENT_FIELD_LABELS[key] ?? key}</Label>
            <Input id={`site-board-content-${key}`} value={String((section as Record<string, unknown>)[key] ?? '')} onChange={(event) => setSection(key, event.target.value)} />
          </div>
        ))}
        {board === 'notice' ? (
          <div className="space-y-1">
            <Label htmlFor="site-board-content-max-pinned">고정 상한(1~20, 지금 고정 {pinnedCount}개 이상)</Label>
            <Input
              id="site-board-content-max-pinned"
              type="number"
              min={Math.max(1, pinnedCount)}
              max={20}
              value={value.notice.maxPinned}
              onChange={(event) => setValue((current) => ({ ...current, notice: { ...current.notice, maxPinned: Number(event.target.value) } }))}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label>FAQ 분류(위에서부터 회원 화면 순서). 글(숨김 포함)이 남은 분류는 지울 수 없습니다.</Label>
            {value.faq.categories.map((category, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <Input className="w-40" aria-label="분류 key(영문 소문자)" value={category.key} onChange={(event) => setCategories(value.faq.categories.map((item, at) => (at === index ? { ...item, key: event.target.value.trim() } : item)))} />
                <Input className="min-w-0 flex-1" aria-label="분류 이름" value={category.label} onChange={(event) => setCategories(value.faq.categories.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)))} />
                <Button size="icon-sm" variant="outline" aria-label="위로" disabled={index === 0} onClick={() => {
                  const next = [...value.faq.categories];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]]
                  setCategories(next)
                }}><ArrowUp /></Button>
                <Button size="icon-sm" variant="outline" aria-label="아래로" disabled={index === value.faq.categories.length - 1} onClick={() => {
                  const next = [...value.faq.categories];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]]
                  setCategories(next)
                }}><ArrowDown /></Button>
                <Button size="sm" variant="outline" disabled={value.faq.categories.length <= 1} onClick={() => setCategories(value.faq.categories.filter((_, at) => at !== index))}>지우기</Button>
              </div>
            ))}
            <Button size="sm" variant="adminTable" disabled={value.faq.categories.length >= 20} onClick={() => setCategories([...value.faq.categories, { key: '', label: '' }])}>
              <Plus /> 분류 추가
            </Button>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="site-board-content-nav">{CONTENT_FIELD_LABELS.navLabel}</Label>
          <Input id="site-board-content-nav" value={value.footer.navLabel} onChange={(event) => setValue((current) => ({ ...current, footer: { navLabel: event.target.value } }))} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="site-board-content-redacted">가림 문구(대표가 [가림]한 글의 제목·본문, 한 줄·100자 이하)</Label>
          <Input id="site-board-content-redacted" value={value.redactedText} onChange={(event) => setValue((current) => ({ ...current, redactedText: event.target.value }))} />
        </div>
        {hits.length > 0 ? (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            개인정보로 보이는 글이 있습니다({hits.map((kind) => MEMBER_FACING_PII_LABELS[kind]).join(', ')}). 저장하면 거절됩니다.
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>안내 문구 저장</Button>
        </div>
      </CardContent>
    </Card>
  )
}
