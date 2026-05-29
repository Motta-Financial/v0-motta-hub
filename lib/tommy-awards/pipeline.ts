/**
 * Tommy Awards — pipeline chaining helper
 * ────────────────────────────────────────
 * The Friday recap runs as four discrete, individually time-budgeted
 * stages (prepare → image → pdf → send). Each prep stage hands off to
 * the next by firing a detached POST at the next stage's cron route and
 * NOT awaiting it — the next stage owns its own Fluid Compute budget, so
 * we never block (or burst past) the current invocation's ceiling.
 *
 * The send stage is the one exception: it is triggered independently by
 * a noon-ET cron rather than by the chain, so the firm always receives
 * an email even if an upstream prep stage failed.
 */

/** Stage route segments under /api/cron, in pipeline order. */
export type PipelineStage = "tommy-podium-image" | "tommy-recap-pdf"

/**
 * Fire-and-forget a POST at the next pipeline stage. Returns immediately;
 * the short abort timeout guarantees a dead/cold route can't keep the
 * current invocation alive. Failures are logged but never thrown — the
 * row already exists, so a missed hand-off can be re-triggered manually.
 */
export function triggerStage(stage: PipelineStage, weekId: string): void {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hub.motta.cpa"
  const triggerUrl = `${appUrl}/api/cron/${stage}`
  void fetch(triggerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ weekId }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    console.error(`[v0] tommy-pipeline: failed to trigger stage ${stage} for week`, weekId, err)
  })
  console.log(`[v0] tommy-pipeline: dispatched stage ${stage} for week`, weekId)
}
