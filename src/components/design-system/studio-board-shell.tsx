import type { ReactNode } from 'react'

interface StudioBoardShellBaseProps {
  summary: ReactNode
  toolbar?: ReactNode
  pagination?: ReactNode
}

interface StudioBoardShellSingleResultsProps {
  /** One responsive result tree when the consumer owns its viewport behavior. */
  results: ReactNode
  desktopResults?: never
  mobileResults?: never
}

interface StudioBoardShellSplitResultsProps {
  results?: never
  /** Presentation-only desktop rendering. Hoist shared state, effects, and portals above both result slots. */
  desktopResults: ReactNode
  /** Presentation-only mobile rendering. Hoist shared state, effects, and portals above both result slots. */
  mobileResults: ReactNode
}

type StudioBoardShellProps = StudioBoardShellBaseProps &
  (StudioBoardShellSingleResultsProps | StudioBoardShellSplitResultsProps)

function hasSingleResults(
  props: StudioBoardShellProps
): props is StudioBoardShellBaseProps & StudioBoardShellSingleResultsProps {
  return 'results' in props
}

export function StudioBoardShell(props: StudioBoardShellProps) {
  const { summary, toolbar, pagination } = props
  const resultContent = hasSingleResults(props) ? (
    <div data-slot="studio-board-results" className="mt-4">
      {props.results}
    </div>
  ) : (
    <>
      <div
        data-slot="studio-board-desktop-results"
        className="mt-4 hidden md:block"
      >
        {props.desktopResults}
      </div>
      <div data-slot="studio-board-mobile-results" className="mt-4 md:hidden">
        {props.mobileResults}
      </div>
    </>
  )

  return (
    <section aria-label="검색 결과">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div aria-live="polite" className="min-w-0">
          {summary}
        </div>
        {toolbar ? (
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
        ) : null}
      </div>

      {resultContent}

      {pagination ? <div className="mt-7">{pagination}</div> : null}
    </section>
  )
}
