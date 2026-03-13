import { getMenuManagementData } from './actions'
import MenuManagementClient from './menu-management-client'

export default async function MenuManagementPage() {
  const data = await getMenuManagementData()

  return <MenuManagementClient {...data} />
}
