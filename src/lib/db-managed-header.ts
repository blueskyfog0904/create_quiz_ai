import type {
  HeaderMenuChildItem,
  HeaderMenuItem,
  HeaderNavigationConfig,
} from '@/lib/header-navigation'

export type DbManagedChildrenSourceMode = 'legacy_json' | 'hybrid_fallback' | 'db_authoritative'

interface DbManagedParentOptions {
  parentHref: string
  fallbackId: string
  fallbackTitle: string
}

function cloneChild(child: HeaderMenuChildItem): HeaderMenuChildItem {
  return { ...child }
}

function cloneItem(item: HeaderMenuItem): HeaderMenuItem {
  return {
    ...item,
    children: item.children.map(cloneChild),
  }
}

export function ensureDbManagedParent(
  config: HeaderNavigationConfig,
  options: DbManagedParentOptions,
  shouldSynthesize = true
) {
  const clonedItems = config.items.map(cloneItem)
  const existingIndex = clonedItems.findIndex((item) => item.href === options.parentHref)

  if (existingIndex >= 0) {
    return {
      config: {
        ...config,
        items: clonedItems,
      },
      wasSynthesized: false,
    }
  }

  if (!shouldSynthesize) {
    return {
      config: {
        ...config,
        items: clonedItems,
      },
      wasSynthesized: false,
    }
  }

  clonedItems.unshift({
    id: options.fallbackId,
    title: options.fallbackTitle,
    href: options.parentHref,
    isActive: true,
    children: [],
  })

  return {
    config: {
      ...config,
      items: clonedItems,
    },
    wasSynthesized: true,
  }
}

function isLegacyChildCoveredByDbChild(child: HeaderMenuChildItem, dbChild: HeaderMenuChildItem) {
  return child.title === dbChild.title || child.href === dbChild.href
}

export function mergeDbManagedChildrenIntoHeaderConfig(
  baseConfig: HeaderNavigationConfig,
  dbChildren: HeaderMenuChildItem[],
  options: DbManagedParentOptions,
  sourceMode: DbManagedChildrenSourceMode = 'hybrid_fallback'
): HeaderNavigationConfig {
  if (sourceMode === 'legacy_json') {
    return {
      ...baseConfig,
      items: baseConfig.items.map(cloneItem),
    }
  }

  const hasExistingParent = baseConfig.items.some((item) => item.href === options.parentHref)
  const { config } = ensureDbManagedParent(baseConfig, options, hasExistingParent || dbChildren.length > 0)
  const shouldFallback = sourceMode === 'hybrid_fallback' && dbChildren.length === 0

  return {
    ...config,
    items: config.items.map((item) => {
      if (item.href !== options.parentHref) {
        return cloneItem(item)
      }

      if (shouldFallback) {
        return cloneItem(item)
      }

      const legacyChildren = sourceMode === 'hybrid_fallback'
        ? item.children
            .filter((child) => !dbChildren.some((dbChild) => isLegacyChildCoveredByDbChild(child, dbChild)))
            .map(cloneChild)
        : []

      return {
        ...item,
        children: [...dbChildren.map(cloneChild), ...legacyChildren],
      }
    }),
  }
}

export function preserveDbManagedParentChildren(
  existingConfig: HeaderNavigationConfig,
  nextConfig: HeaderNavigationConfig,
  parentHrefs: string[]
): HeaderNavigationConfig {
  const preservedChildrenByHref = new Map(
    existingConfig.items
      .filter((item) => item.href && parentHrefs.includes(item.href))
      .map((item) => [item.href as string, item.children.map(cloneChild)])
  )

  return {
    ...nextConfig,
    items: nextConfig.items.map((item) => {
      if (!item.href || !preservedChildrenByHref.has(item.href)) {
        return cloneItem(item)
      }

      return {
        ...item,
        children: preservedChildrenByHref.get(item.href) ?? [],
      }
    }),
  }
}
