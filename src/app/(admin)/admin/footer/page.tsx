import FooterSettingsClient from './footer-client'
import { getFooterSettingsData } from './actions'

export default async function FooterSettingsPage() {
  const data = await getFooterSettingsData()

  return <FooterSettingsClient {...data} />
}
