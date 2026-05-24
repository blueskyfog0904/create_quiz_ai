import type { WorkspaceSubject } from './workspace-subject'

interface WorkspaceSubjectTheme {
  marketHeroClass: string
  marketHeroLabelClass: string
  marketHeroMutedTextClass: string
}

const englishWorkspaceTheme: WorkspaceSubjectTheme = {
  marketHeroClass: 'border-blue-200/60 bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600',
  marketHeroLabelClass: 'text-sky-100',
  marketHeroMutedTextClass: 'text-sky-100/85',
}

const koreanWorkspaceTheme: WorkspaceSubjectTheme = {
  marketHeroClass: 'border-emerald-200/60 bg-gradient-to-br from-emerald-700 via-teal-600 to-cyan-600',
  marketHeroLabelClass: 'text-emerald-100',
  marketHeroMutedTextClass: 'text-emerald-100/85',
}

export function getWorkspaceSubjectTheme(subject: WorkspaceSubject): WorkspaceSubjectTheme {
  return subject === 'korean' ? koreanWorkspaceTheme : englishWorkspaceTheme
}
