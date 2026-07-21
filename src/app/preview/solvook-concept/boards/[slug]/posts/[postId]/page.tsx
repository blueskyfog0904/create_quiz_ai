import { notFound } from 'next/navigation'
import { MaterialDetail } from '@/app/preview/solvook-concept/_components/detail/material-detail'
import {
  getSampleBoard,
  getSamplePost,
} from '@/app/preview/solvook-concept/_data/sample-data'

interface SampleMaterialDetailPageProps {
  params: Promise<{
    slug: string
    postId: string
  }>
}

export default async function SampleMaterialDetailPage({
  params,
}: SampleMaterialDetailPageProps) {
  const { slug, postId } = await params
  const board = getSampleBoard(slug)
  const post = getSamplePost(slug, postId)

  if (!board || !post) {
    notFound()
  }

  return <MaterialDetail board={board} post={post} />
}
