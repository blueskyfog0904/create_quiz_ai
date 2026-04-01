import { redirect } from 'next/navigation'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'

interface MultiGeneratePageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MultiGeneratePage({ searchParams }: MultiGeneratePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveWorkspaceSubject(resolvedSearchParams?.subject)
  redirect(`/generate/personal?subject=${workspaceSubject}`)
}
