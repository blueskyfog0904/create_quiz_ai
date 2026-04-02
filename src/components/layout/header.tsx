import { createClient } from '@/lib/supabase/server'
import { HeaderShellClient } from './header-shell-client'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'

function reorderGenerateChildren(items: ReturnType<typeof getActiveHeaderNavigationItems>) {
  return items.map((item) => {
    if (item.href !== '/generate' || item.children.length === 0) {
      return item
    }

    const personalChild = item.children.find((child) => child.href === '/generate/personal') ?? null
    const otherChildren = item.children.filter((child) => child.href !== '/generate/personal')

    return {
      ...item,
      children: personalChild ? [...otherChildren, personalChild] : item.children,
    }
  })
}

export async function Header() {
  const supabase = await createClient()
  const [englishConfig, koreanConfig] = await Promise.all([
    getHeaderNavigationConfig('english'),
    getHeaderNavigationConfig('korean'),
  ])

  let user = null

  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    user = null
  }

  let profile = null
  let isAdmin = false
  if (user) {
    const { data } = await supabase
      .from('profiles')
      .select('name, email, is_admin, credits')
      .eq('id', user.id)
      .single()
    profile = data
    isAdmin = data?.is_admin || false
  }

  return (
    <HeaderShellClient
      englishMenuItems={reorderGenerateChildren(getActiveHeaderNavigationItems(englishConfig.items))}
      koreanMenuItems={reorderGenerateChildren(getActiveHeaderNavigationItems(koreanConfig.items))}
      isLoggedIn={Boolean(user)}
      userName={profile?.name || profile?.email || user?.email || ''}
      isAdmin={isAdmin}
      creditBalance={profile?.credits ?? 0}
    />
  )
}
