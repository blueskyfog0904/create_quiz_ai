import type { MainLandingConfig } from '@/lib/landing-page'
import { MainLandingView } from './MainLandingView'

interface MainLandingProps {
  config: MainLandingConfig
}

export function MainLanding({ config }: MainLandingProps) {
  return <MainLandingView config={config} />
}
