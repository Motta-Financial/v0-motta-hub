import { DashboardLayout } from "@/components/dashboard-layout"
import { Form1040EntryClient } from "@/components/tax/form-1040-entry-client"

interface PageProps {
  params: Promise<{ setId: string }>
}

/**
 * /tax/intake/[setId]/1040 — key figures straight onto Form 1040 lines.
 *
 * The sibling page (`../page.tsx`) gathers source documents and derives the
 * return from them, which is the right path for anything that arrives on a
 * form. This page covers what that path cannot express: lines with no
 * document behind them — Schedule 1 totals, estimated payments, a
 * prior-year overpayment applied forward.
 *
 * Both write into the same intake set. Neither sends anything to Intuit.
 */
export default async function Form1040EntryPage({ params }: PageProps) {
  const { setId } = await params
  return (
    <DashboardLayout>
      <Form1040EntryClient setId={setId} />
    </DashboardLayout>
  )
}
