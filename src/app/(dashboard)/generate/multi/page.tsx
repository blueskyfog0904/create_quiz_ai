import { redirect } from 'next/navigation'

export default async function MultiGeneratePage() {
  redirect('/generate/personal')
}
