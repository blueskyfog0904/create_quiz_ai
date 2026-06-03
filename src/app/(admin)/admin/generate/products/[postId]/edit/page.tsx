import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject, withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  getGenerateListboardPostForAdmin,
  listGenerateListboardPostItemsForAdmin,
} from '@/lib/generate-menu-server'
import type { GenerateListboardPost, GenerateListboardPostItem } from '@/lib/generate-menu'
import GenerateProductEditClient from './generate-product-edit-client'

interface GenerateProductEditPageProps {
  params: Promise<{ postId: string }>
  searchParams?: Promise<{ subject?: string }>
}

export default async function GenerateProductEditPage({ params, searchParams }: GenerateProductEditPageProps) {
  await requireAdmin()

  const { postId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  let post: GenerateListboardPost
  let postItems: GenerateListboardPostItem[]
  try {
    post = await getGenerateListboardPostForAdmin(postId, workspaceSubject)
    postItems = await listGenerateListboardPostItemsForAdmin(post.id, workspaceSubject)
  } catch {
    redirect(withAdminWorkspaceSubject('/admin/generate/products', workspaceSubject))
  }

  return (
    <GenerateProductEditClient
      post={post}
      initialPostItems={postItems}
      workspaceSubject={workspaceSubject}
    />
  )
}
