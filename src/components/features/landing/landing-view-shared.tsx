import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  BrainCircuit,
  FileText,
  FolderKanban,
  Languages,
  LibraryBig,
  PackageSearch,
  ScrollText,
  ShoppingBag,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import type { LandingIconToken, LandingThemeToken } from '@/lib/landing-page'

export const landingIconComponents: Record<LandingIconToken, LucideIcon> = {
  sparkles: Sparkles,
  bookOpen: BookOpen,
  fileText: FileText,
  languages: Languages,
  libraryBig: LibraryBig,
  brainCircuit: BrainCircuit,
  folderKanban: FolderKanban,
  packageSearch: PackageSearch,
  shoppingBag: ShoppingBag,
  scrollText: ScrollText,
  wandSparkles: WandSparkles,
}

export const landingIconLabels: Record<LandingIconToken, string> = {
  sparkles: 'Sparkles',
  bookOpen: 'Book Open',
  fileText: 'File Text',
  languages: 'Languages',
  libraryBig: 'Library',
  brainCircuit: 'Brain Circuit',
  folderKanban: 'Folder Kanban',
  packageSearch: 'Package Search',
  shoppingBag: 'Shopping Bag',
  scrollText: 'Scroll Text',
  wandSparkles: 'Wand Sparkles',
}

export const landingThemeLabels: Record<LandingThemeToken, string> = {
  indigo: 'Indigo',
  emerald: 'Emerald',
  neutral: 'Neutral',
}

export function getMainLandingAccentClass(theme: LandingThemeToken) {
  switch (theme) {
    case 'emerald':
      return 'from-emerald-500/20 via-teal-500/10 to-cyan-400/20'
    case 'neutral':
      return 'from-slate-500/20 via-slate-400/10 to-zinc-300/20'
    case 'indigo':
    default:
      return 'from-indigo-500/20 via-blue-500/10 to-sky-400/20'
  }
}

export function getWorkspaceLandingThemeStyles(theme: LandingThemeToken) {
  switch (theme) {
    case 'emerald':
      return {
        heroGradient: 'from-emerald-600 via-teal-600 to-cyan-500',
        heroGlow: 'bg-emerald-500/30',
        badgeClass: 'border-white/20 bg-white/10 text-white',
        cardAccentClass: 'from-emerald-500/10 via-teal-400/5 to-cyan-400/10',
        ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
        sectionTintClass: 'from-emerald-500/5 via-transparent to-cyan-500/5',
      }
    case 'neutral':
      return {
        heroGradient: 'from-slate-700 via-slate-600 to-zinc-500',
        heroGlow: 'bg-slate-500/30',
        badgeClass: 'border-white/20 bg-white/10 text-white',
        cardAccentClass: 'from-slate-500/10 via-zinc-400/5 to-slate-300/10',
        ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
        sectionTintClass: 'from-slate-500/5 via-transparent to-zinc-500/5',
      }
    case 'indigo':
    default:
      return {
        heroGradient: 'from-indigo-600 via-blue-600 to-sky-500',
        heroGlow: 'bg-indigo-500/30',
        badgeClass: 'border-white/20 bg-white/10 text-white',
        cardAccentClass: 'from-indigo-500/10 via-blue-400/5 to-sky-400/10',
        ctaButtonClass: 'bg-white text-slate-900 hover:bg-slate-100',
        sectionTintClass: 'from-indigo-500/5 via-transparent to-sky-500/5',
      }
  }
}
