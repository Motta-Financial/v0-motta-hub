import { TaxProjectDetailClient } from "@/components/tax/tax-project-detail-client"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TaxProjectDetailPage({ params }: PageProps) {
  const { id } = await params
  return <TaxProjectDetailClient projectId={id} />
}
