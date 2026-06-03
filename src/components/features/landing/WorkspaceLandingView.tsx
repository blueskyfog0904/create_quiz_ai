'use client'

import Link from 'next/link'
import { ArrowRight, ArrowUpRight, LibraryBig, Sparkles, WandSparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { WorkspaceLandingConfig } from '@/lib/landing-page'
import { workspaceHref } from '@/lib/workspace-routes'
import {
  getWorkspaceLandingFeatureGridClassName,
  getWorkspaceLandingWorkflowGridClassName,
} from '@/lib/workspace-landing-layout'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  getLandingFontSizeStyle,
  getWorkspaceLandingThemeStyles,
  landingIconComponents,
} from './landing-view-shared'

interface WorkspaceLandingQuickEntry {
  primaryLabel: string
  primaryHref: string
  secondaryLabel: string | null
  secondaryHref: string | null
}

interface WorkspaceLandingViewProps {
  subject: WorkspaceSubject
  config: WorkspaceLandingConfig
  quickEntry: WorkspaceLandingQuickEntry
}

function getWorkspaceLandingFeatureHref(
  subject: WorkspaceSubject,
  index: number,
  quickEntry: WorkspaceLandingQuickEntry
) {
  if (subject === 'korean') {
    return index === 2
      ? workspaceHref(subject, 'libraryMarket')
      : quickEntry.primaryHref
  }

  if (index === 0) return quickEntry.primaryHref
  if (index === 1) return quickEntry.secondaryHref ?? workspaceHref(subject, 'market')
  if (index === 2) return workspaceHref(subject, 'libraryPurchased')
  if (index === 3) return workspaceHref(subject, 'libraryExamPapers')

  return workspaceHref(subject, 'home')
}

export function WorkspaceLandingView({
  subject,
  config,
  quickEntry,
}: WorkspaceLandingViewProps) {
  const theme = getWorkspaceLandingThemeStyles(config.theme)
  const primaryHref = quickEntry.primaryHref
  const secondaryHref = quickEntry.secondaryHref
  const featureGridClassName = getWorkspaceLandingFeatureGridClassName(config.features.length)
  const workflowGridClassName = getWorkspaceLandingWorkflowGridClassName(config.steps.length)
  const guideButton = (
    <div className="rounded-2xl border border-white/20 bg-white/12 p-3 shadow-lg shadow-slate-900/10 ring-1 ring-white/15 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <Badge className="border-white/20 bg-white/15 text-white">
          <Sparkles className="h-3.5 w-3.5" />
          사용방법
        </Badge>
        <span className="text-xs font-medium text-white/70">
          처음이라면 먼저 확인
        </span>
      </div>
      <Button
        asChild
        size="lg"
        className={`mt-3 w-full justify-between ${theme.ctaButtonClass}`}
      >
        <a href={config.guide.url} target="_blank" rel="noreferrer noopener">
          {config.guide.label}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </Button>
    </div>
  )

  return (
    <div className="relative overflow-hidden bg-slate-50 text-slate-900">
      <div className={`absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full blur-3xl ${theme.heroGlow}`} />
      <div className={`absolute inset-x-0 top-0 h-[34rem] bg-gradient-to-b ${theme.sectionTintClass}`} />

      <section className="relative container mx-auto px-4 py-16 md:py-20">
        <div className={`overflow-hidden rounded-[2rem] bg-gradient-to-br ${theme.heroGradient} px-6 py-10 text-white shadow-2xl shadow-slate-900/10 md:px-10 md:py-14`}>
          <div className="mx-auto max-w-5xl">
            <Badge className={`${theme.badgeClass} px-4 py-1 text-sm backdrop-blur-sm`}>
              <WandSparkles className="h-3.5 w-3.5" />
              <span style={getLandingFontSizeStyle(config.fontSteps.hero.eyebrow, { mobileRem: 0.875 })}>
                {config.eyebrow}
              </span>
            </Badge>

            <div className="mt-6 grid gap-10 lg:grid-cols-[1.4fr_0.9fr] lg:items-start">
              <div className="lg:pt-6">
                <h1
                  className="font-bold tracking-tight whitespace-pre-line word-keep-all"
                  style={getLandingFontSizeStyle(config.fontSteps.hero.title, { mobileRem: 2.25, desktopRem: 3.75, lineHeight: 1.05 })}
                >
                  {config.title}
                </h1>
                <p
                  className="mt-6 max-w-3xl text-white/90 whitespace-pre-line word-keep-all"
                  style={getLandingFontSizeStyle(config.fontSteps.hero.description, { mobileRem: 1.125, desktopRem: 1.25, lineHeight: 1.7 })}
                >
                  {config.description}
                </p>
                <p
                  className="mt-4 max-w-3xl text-white/75 whitespace-pre-line word-keep-all"
                  style={getLandingFontSizeStyle(config.fontSteps.hero.heroSummary, { mobileRem: 1, lineHeight: 1.7 })}
                >
                  {config.heroSummary}
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  {config.quickPills.map((pill) => (
                    <span
                      key={pill}
                      className="rounded-full border border-white/20 bg-white/10 px-4 py-2 font-medium text-white/90 backdrop-blur-sm"
                      style={getLandingFontSizeStyle(config.fontSteps.hero.quickPills, { mobileRem: 0.875 })}
                    >
                      {pill}
                    </span>
                  ))}
                </div>
              </div>

              <Card className="border-white/15 bg-white/10 py-0 text-white shadow-lg backdrop-blur-md">
                <CardContent className="p-6">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/70">
                    Quick Entry
                  </p>
                  <h2 className="mt-3 text-2xl font-bold word-keep-all">
                    지금 바로 {subject === 'english' ? '영어' : '국어'} 워크스페이스로 이동하세요
                  </h2>
                  <p
                    className="mt-3 text-white/75 whitespace-pre-line word-keep-all"
                    style={getLandingFontSizeStyle(config.fontSteps.cta.hint, { mobileRem: 0.875, lineHeight: 1.6 })}
                  >
                    {config.ctaHint}
                  </p>
                  <Separator className="my-5 bg-white/15" />
                  <div className="flex flex-col gap-3">
                    <Link href={primaryHref}>
                      <Button size="lg" variant="outline" className="w-full justify-between border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                        {quickEntry.primaryLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                    {secondaryHref && quickEntry.secondaryLabel ? (
                      <Link href={secondaryHref}>
                        <Button size="lg" variant="outline" className="w-full justify-between border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                          {quickEntry.secondaryLabel}
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>
                    ) : null}
                    {guideButton}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <section className="relative container mx-auto px-4 pb-8">
        <div className="mb-8 text-center">
          <h2
            className="font-bold text-slate-900 word-keep-all"
            style={getLandingFontSizeStyle(config.fontSteps.featureSection.heading, { mobileRem: 1.5, desktopRem: 1.875, lineHeight: 1.2 })}
          >
            {config.featureHeading}
          </h2>
          <p
            className="mx-auto mt-3 max-w-3xl text-slate-600 whitespace-pre-line word-keep-all"
            style={getLandingFontSizeStyle(config.fontSteps.featureSection.intro, { mobileRem: 1, lineHeight: 1.7 })}
          >
            {config.featureIntro}
          </p>
        </div>

        <div className={featureGridClassName}>
          {config.features.map((feature, index) => {
            const Icon = landingIconComponents[feature.icon]
            const featureHref = getWorkspaceLandingFeatureHref(subject, index, quickEntry)

            return (
              <Link
                key={feature.title}
                href={featureHref}
                aria-label={`${feature.title} 페이지로 이동`}
                className="group block h-full rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
              >
                <Card className="relative h-full overflow-hidden border-slate-200 bg-white py-0 shadow-md shadow-slate-200/60 transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg">
                  <div className={`absolute inset-0 bg-gradient-to-br ${theme.cardAccentClass}`} />
                  <CardContent className="relative p-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3
                      className="mt-5 font-semibold text-slate-900 word-keep-all"
                      style={getLandingFontSizeStyle(config.fontSteps.featureSection.title, { mobileRem: 1.25, lineHeight: 1.3 })}
                    >
                      {feature.title}
                    </h3>
                    <p
                      className="mt-3 text-slate-600 whitespace-pre-line word-keep-all"
                      style={getLandingFontSizeStyle(config.fontSteps.featureSection.description, { mobileRem: 0.875, lineHeight: 1.7 })}
                    >
                      {feature.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="container mx-auto px-4 py-14">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="mb-8 text-center">
            <Badge variant="outline" className="border-slate-300 bg-slate-50 px-4 py-1 text-slate-700">
              <Sparkles className="h-3.5 w-3.5" />
              <span style={getLandingFontSizeStyle(config.fontSteps.workflowSection.badge, { mobileRem: 0.875 })}>
                {config.workflowBadge}
              </span>
            </Badge>
            <h2
              className="mt-5 font-bold text-slate-900 word-keep-all"
              style={getLandingFontSizeStyle(config.fontSteps.workflowSection.heading, { mobileRem: 1.5, desktopRem: 1.875, lineHeight: 1.2 })}
            >
              {config.workflowHeading}
            </h2>
            <p
              className="mx-auto mt-3 max-w-3xl text-slate-600 whitespace-pre-line word-keep-all"
              style={getLandingFontSizeStyle(config.fontSteps.workflowSection.intro, { mobileRem: 1, lineHeight: 1.7 })}
            >
              {config.workflowIntro}
            </p>
          </div>

          <div className={workflowGridClassName}>
            {config.steps.map((step, index) => {
              const Icon = landingIconComponents[step.icon]

              return (
                <div key={step.title} className="relative rounded-3xl border border-slate-200 bg-slate-50 p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-900 shadow-sm ring-1 ring-slate-200">
                      <Icon className="h-6 w-6" />
                    </div>
                    <span className="text-sm font-semibold text-slate-400">
                      0{index + 1}
                    </span>
                  </div>
                  <h3
                    className="mt-5 font-semibold text-slate-900 word-keep-all"
                    style={getLandingFontSizeStyle(config.fontSteps.workflowSection.title, { mobileRem: 1.25, lineHeight: 1.3 })}
                  >
                    {step.title}
                  </h3>
                  <p
                    className="mt-3 text-slate-600 whitespace-pre-line word-keep-all"
                    style={getLandingFontSizeStyle(config.fontSteps.workflowSection.description, { mobileRem: 0.875, lineHeight: 1.7 })}
                  >
                    {step.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 pb-20">
        <div className={`overflow-hidden rounded-[2rem] bg-gradient-to-r ${theme.heroGradient} p-8 text-white shadow-2xl shadow-slate-900/10 md:p-10`}>
          <div className="grid gap-8 lg:grid-cols-[1.3fr_0.9fr] lg:items-center">
            <div>
              <Badge className="border-white/20 bg-white/10 text-white">
                <Sparkles className="h-3.5 w-3.5" />
                Recommended Next Step
              </Badge>
              <h2
                className="mt-5 font-bold word-keep-all"
                style={getLandingFontSizeStyle(config.fontSteps.cta.headline, { mobileRem: 1.875, desktopRem: 2.25, lineHeight: 1.15 })}
              >
                {config.ctaHeadline}
              </h2>
              <p
                className="mt-4 text-white/85 whitespace-pre-line word-keep-all"
                style={getLandingFontSizeStyle(config.fontSteps.cta.body, { mobileRem: 1, lineHeight: 1.7 })}
              >
                {config.ctaBody}
              </p>
              <p
                className="mt-3 text-white/70 whitespace-pre-line word-keep-all"
                style={getLandingFontSizeStyle(config.fontSteps.cta.hint, { mobileRem: 0.875, lineHeight: 1.6 })}
              >
                {config.ctaHint}
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-white/20 bg-white/10 p-5 backdrop-blur-sm">
              <div className="space-y-3 text-sm text-white/80">
                <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
                  <Sparkles className="h-4 w-4" />
                  {quickEntry.primaryLabel}
                </div>
                {quickEntry.secondaryLabel ? (
                  <div className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
                    <LibraryBig className="h-4 w-4" />
                    {quickEntry.secondaryLabel}
                  </div>
                ) : null}
              </div>
              <div className="mt-5 flex flex-col gap-3">
                <Link href={primaryHref}>
                  <Button size="lg" className={`w-full justify-between ${theme.ctaButtonClass}`}>
                    {quickEntry.primaryLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                {secondaryHref && quickEntry.secondaryLabel ? (
                  <Link href={secondaryHref}>
                    <Button size="lg" variant="outline" className="w-full justify-between border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white">
                      {quickEntry.secondaryLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
