import { getMenuManagementConfig } from './actions'
import MenuManagementClient from './menu-management-client'

export default async function MenuManagementPage() {
  const initialConfig = await getMenuManagementConfig()

  return <MenuManagementClient initialConfig={initialConfig} />
}
