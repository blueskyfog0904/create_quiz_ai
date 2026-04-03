import { MainLanding } from '@/components/features/landing/MainLanding'
import { getMainLandingConfig } from '@/lib/landing-page-server'

export default async function Home() {
  const config = await getMainLandingConfig()

  return <MainLanding config={config} />
}
