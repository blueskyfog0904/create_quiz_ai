import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import GenerateSidebar from './generate-sidebar'

export default async function GenerateLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const navigationConfig = await getHeaderNavigationConfig()
  const activeNavigationItems = getActiveHeaderNavigationItems(navigationConfig.items)
  const generateMenu = activeNavigationItems.find((item) => {
    if (item.href === '/generate') return true
    return item.children.some((child) => child.href.startsWith('/generate/'))
  })

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {generateMenu?.children.length ? (
          <GenerateSidebar parentTitle={generateMenu.title} items={generateMenu.children} />
        ) : null}
        <div className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
