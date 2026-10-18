import { Form1065Viewer } from "@/components/tax/form-1065-viewer"

interface PageProps {
  params: Promise<{ returnId: string }>
  searchParams: Promise<{ clientId?: string }>
}

/**
 * /tax/returns/[returnId]/1065 — standalone Form 1065 viewer.
 *
 * Like the 1040 viewer, no DashboardLayout wrapper: it reads as a document
 * and can sit in its own tab next to the Hub.
 */
export default async function Form1065Page({ params, searchParams }: PageProps) {
  const { returnId } = await params
  const { clientId } = await searchParams
  return <Form1065Viewer returnId={returnId} clientId={clientId} />
}

export const metadata = {
  title: "Form 1065 | Motta Hub",
  description: "View Form 1065 (U.S. Return of Partnership Income)",
}
