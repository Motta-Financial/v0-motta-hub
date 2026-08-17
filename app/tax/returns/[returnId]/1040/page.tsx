import { Form1040Viewer } from "@/components/tax/form-1040-viewer"

interface PageProps {
  params: Promise<{ returnId: string }>
  searchParams: Promise<{ taxYear?: string; clientId?: string }>
}

/**
 * /tax/returns/[returnId]/1040 — Standalone Form 1040 Viewer
 *
 * This page is designed to open in a new tab/window from the Tax Profile page.
 * It renders a complete Form 1040 view with all line items organized by category,
 * expandable sections, and a print-friendly layout.
 *
 * No DashboardLayout wrapper so it feels like a document viewer rather than
 * a dashboard page — this lets users keep the main Hub open in another window.
 */
export default async function Form1040Page({ params, searchParams }: PageProps) {
  const { returnId } = await params
  const { taxYear, clientId } = await searchParams
  // No year in the URL means "use the return's own year" — the API resolves it
  // from the snapshot. It used to default to 2025 here, which silently rendered
  // every TY2024 return as a 2025 form.
  const year = taxYear ? parseInt(taxYear, 10) : undefined

  return (
    <Form1040Viewer
      returnId={returnId}
      taxYear={year}
      clientId={clientId}
    />
  )
}

// Metadata for the standalone page
export async function generateMetadata({ params, searchParams }: PageProps) {
  const { returnId } = await params
  const { taxYear } = await searchParams

  // The tab title cannot name a year we have not resolved yet — the return's
  // year lives on the snapshot and the API decides it. Naming a year here would
  // reintroduce the same lie in the tab title, so stay generic unless the URL
  // was explicit.
  return taxYear
    ? {
        title: `Form 1040 - TY${taxYear} | Motta Hub`,
        description: `View Form 1040 (U.S. Individual Income Tax Return) for Tax Year ${taxYear}`,
      }
    : {
        title: "Form 1040 | Motta Hub",
        description: "View Form 1040 (U.S. Individual Income Tax Return)",
      }
}
