'use client'

import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { MainLandingConfig } from '@/lib/landing-page'
import {
  getLandingFontSizeStyle,
  getMainLandingAccentClass,
  landingIconComponents,
} from './landing-view-shared'

interface MainLandingViewProps {
  config: MainLandingConfig
}

export function MainLandingView({ config }: MainLandingViewProps) {
  return (
    <div className="relative overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.35),_transparent_55%),radial-gradient(circle_at_80%_20%,_rgba(45,212,191,0.28),_transparent_35%)]" />
      <div className="absolute left-1/2 top-24 h-64 w-64 -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />

      <section className="relative container mx-auto px-4 pb-20 pt-16 md:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <Badge className="border-white/20 bg-white/10 px-4 py-1 text-sm text-white backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" />
            <span style={getLandingFontSizeStyle(config.fontSteps.hero.badge, { mobileRem: 0.875 })}>
              {config.hero.badge}
            </span>
          </Badge>
          <h1
            className="mt-6 font-bold tracking-tight word-keep-all"
            style={getLandingFontSizeStyle(config.fontSteps.hero.title, { mobileRem: 2.25, desktopRem: 3.75, lineHeight: 1.05 })}
          >
            {config.hero.title}
          </h1>
          <p
            className="mx-auto mt-6 max-w-3xl text-slate-200 whitespace-pre-line word-keep-all"
            style={getLandingFontSizeStyle(config.fontSteps.hero.description, { mobileRem: 1.125, desktopRem: 1.25, lineHeight: 1.7 })}
          >
            {config.hero.description}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-200">
            {config.hero.chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2"
                style={getLandingFontSizeStyle(config.fontSteps.hero.chips, { mobileRem: 0.875 })}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className="mx-auto mt-14 grid max-w-6xl gap-6 text-left lg:grid-cols-2">
          {config.workspaceCards.map((card) => {
            const Icon = landingIconComponents[card.icon]

            return (
              <Card key={card.subject} className="group relative h-full overflow-hidden rounded-[2rem] border-white/10 bg-white/95 py-0 text-slate-900 shadow-2xl shadow-slate-950/20 transition duration-300 hover:-translate-y-1 hover:shadow-indigo-500/10">
                <div className={`absolute inset-0 bg-gradient-to-br ${getMainLandingAccentClass(card.accentTheme)}`} />
                <CardContent className="relative flex h-full flex-col p-8 md:p-10">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div
                        className="font-semibold text-primary"
                        style={getLandingFontSizeStyle(config.fontSteps.workspaceCards.label, { mobileRem: 0.875 })}
                      >
                        {card.label}
                      </div>
                      <h2
                        className="mt-3 font-bold word-keep-all"
                        style={getLandingFontSizeStyle(config.fontSteps.workspaceCards.title, { mobileRem: 1.875, desktopRem: 2.25, lineHeight: 1.15 })}
                      >
                        {card.title}
                      </h2>
                    </div>
                    <div className="rounded-2xl bg-slate-900 p-3 text-white shadow-lg">
                      <Icon className="h-6 w-6" />
                    </div>
                  </div>

                  <p
                    className="mt-5 text-slate-700 whitespace-pre-line word-keep-all"
                    style={getLandingFontSizeStyle(config.fontSteps.workspaceCards.description, { mobileRem: 1, lineHeight: 1.7 })}
                  >
                    {card.description}
                  </p>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {card.highlightChips.map((highlight) => (
                      <span
                        key={highlight}
                        className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 font-medium text-slate-700 backdrop-blur-sm"
                        style={getLandingFontSizeStyle(config.fontSteps.workspaceCards.highlightChips, { mobileRem: 0.875 })}
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>

                  <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
                    <Button asChild size="lg" variant={card.subject === 'english' ? 'default' : 'outline'} className="px-6">
                      <Link
                        href={`/${card.subject}`}
                        style={getLandingFontSizeStyle(config.fontSteps.workspaceCards.buttonLabel, { mobileRem: 0.9375 })}
                      >
                        {card.buttonLabel}
                      </Link>
                    </Button>
                    <Link href={`/${card.subject}`} className="flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900">
                      자세히 보기
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="relative border-t border-white/10 bg-white/5 py-16 backdrop-blur-sm">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <h2
              className="font-bold word-keep-all"
              style={getLandingFontSizeStyle(config.fontSteps.valueSection.heading, { mobileRem: 1.5, desktopRem: 1.875, lineHeight: 1.2 })}
            >
              {config.valueSection.heading}
            </h2>
            <p
              className="mt-3 text-slate-200 whitespace-pre-line word-keep-all"
              style={getLandingFontSizeStyle(config.fontSteps.valueSection.intro, { mobileRem: 1, lineHeight: 1.7 })}
            >
              {config.valueSection.intro}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {config.valuePoints.map((point) => {
              const Icon = landingIconComponents[point.icon]

              return (
                <div key={point.title} className="rounded-3xl border border-white/10 bg-white/10 p-6 text-white shadow-lg shadow-slate-950/10 backdrop-blur-sm">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3
                    className="mt-5 font-semibold word-keep-all"
                    style={getLandingFontSizeStyle(config.fontSteps.valuePoints.title, { mobileRem: 1.25, lineHeight: 1.3 })}
                  >
                    {point.title}
                  </h3>
                  <p
                    className="mt-3 text-slate-200 whitespace-pre-line word-keep-all"
                    style={getLandingFontSizeStyle(config.fontSteps.valuePoints.description, { mobileRem: 0.875, lineHeight: 1.7 })}
                  >
                    {point.description}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
