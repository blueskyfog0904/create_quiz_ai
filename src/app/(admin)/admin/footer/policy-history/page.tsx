import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { readPolicyDocumentSnapshots } from '@/lib/signup-consent-server'

export const metadata: Metadata = {
  title: '약관 이력',
}

export const dynamic = 'force-dynamic'

const formatDateTime = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// 약관 본문 이력(읽기 전용). 하단 정보에서 약관을 저장할 때마다 DB 가 본문 사본을 남긴다(고칠 수 없는 표).
// 회원 상세의 '약관 사본' 지문으로 그 회원이 동의한 당시 본문을 찾는다.
export default async function PolicyHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminPagePermission('site.manage')
  const params = await searchParams
  const rawHash = Array.isArray(params.hash) ? params.hash[0] : params.hash
  const hash = rawHash && /^[0-9a-f]{64}$/.test(rawHash) ? rawHash : null
  const snapshots = await readPolicyDocumentSnapshots({ hash })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/footer" className="text-sm text-gray-500 underline underline-offset-2">← 사이트 기본 정보</Link>
        <h1 className="text-3xl font-bold text-gray-900">약관 이력</h1>
        <p className="text-gray-500">
          약관을 저장할 때마다 본문이 바뀐 문서의 사본이 남습니다(지울 수 없음). 각 사본은 그 시각부터 다음 사본 전까지 시행된 본문입니다.
        </p>
        {hash ? (
          <p className="text-sm">
            지문 <code className="rounded bg-gray-100 px-1">{hash.slice(0, 8)}</code> 의 본문만 보는 중 ·{' '}
            <Link href="/admin/footer/policy-history" className="underline underline-offset-2">전체 보기</Link>
          </p>
        ) : null}
      </div>

      {!snapshots ? (
        <p className="text-sm text-red-600">약관 이력을 불러오지 못했습니다.</p>
      ) : snapshots.length === 0 ? (
        <p className="text-sm text-gray-500">사본이 없습니다.</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {snapshots.map((snapshot) => (
            <li key={snapshot.id} className="p-4">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold">{snapshot.title || snapshot.docKey}</span>
                  <span className="text-gray-500">{formatDateTime(snapshot.createdAt)}</span>
                  <code className="rounded bg-gray-100 px-1 text-xs">{snapshot.contentSha256.slice(0, 8)}</code>
                  <span className="text-xs text-gray-400">#{snapshot.seq}</span>
                </summary>
                <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap break-keep rounded-md bg-gray-50 p-3 text-xs leading-5 text-gray-700">
                  {snapshot.content}
                </pre>
                <p className="mt-2 break-all text-xs text-gray-400">sha256 {snapshot.contentSha256}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
