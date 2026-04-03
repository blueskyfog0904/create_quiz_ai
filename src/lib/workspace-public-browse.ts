import { stripWorkspacePrefix } from '@/lib/workspace-subject'

function getScopedSegments(pathname: string) {
  return stripWorkspacePrefix(pathname).scopedPath.split('/').filter(Boolean)
}

export function isPublicBrowseableSubjectPath(pathname: string) {
  const segments = getScopedSegments(pathname)

  if (segments.length === 0) {
    return false
  }

  if (segments[0] === 'generate') {
    if (segments.length === 1) return true
    if (segments.length === 2) return true // personal, multi, [typeId]

    if (segments[1] === 'boards') {
      if (segments.length === 3) return true // /generate/boards/[slug]
      if (segments.length === 5 && segments[3] === 'posts') return true // /generate/boards/[slug]/posts/[postId]
      if (segments.length === 7 && segments[3] === 'posts' && segments[5] === 'generate') return true // /generate/boards/[slug]/posts/[postId]/generate/[typeId]
    }

    return false
  }

  if (segments[0] === 'market') {
    if (segments.length === 1) return true
    if (segments.length === 2) return true // /market/[slug]
    if (segments.length === 4 && segments[2] === 'items') return true // /market/[slug]/items/[itemId]
    return false
  }

  return false
}
