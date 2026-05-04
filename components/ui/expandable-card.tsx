"use client"

import * as React from "react"
import { ChevronDown, ChevronUp, Maximize2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

interface ExpandableCardProps {
  title: string
  description?: string
  icon?: React.ReactNode
  defaultExpanded?: boolean
  children: React.ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
  collapsible?: boolean
  /**
   * When true, renders a Maximize button in the header that pops the card
   * content into a full-viewport dialog so the user can drill into the
   * underlying data without being constrained by the card's bounding box.
   * Defaults to true — every dashboard widget should support this.
   */
  maximizable?: boolean
  /**
   * Optional override for the maximized dialog body. Useful when a widget
   * wants to render a richer / detailed view in the modal than the compact
   * version shown inside the card. If omitted, `children` is reused.
   */
  expandedContent?: React.ReactNode
}

export function ExpandableCard({
  title,
  description,
  icon,
  defaultExpanded = true,
  children,
  className,
  headerClassName,
  contentClassName,
  badge,
  actions,
  collapsible = true,
  maximizable = true,
  expandedContent,
}: ExpandableCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)
  const [isMaximized, setIsMaximized] = React.useState(false)

  // The maximize button is rendered alongside any caller-supplied actions so
  // it's always available regardless of whether the card is collapsed or not.
  // Stop propagation so a click on the button doesn't also toggle the
  // CollapsibleTrigger that wraps the header row.
  const maxBtn = maximizable ? (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsMaximized(true)
      }}
      aria-label={`Expand ${title}`}
    >
      <Maximize2 className="h-4 w-4" />
    </Button>
  ) : null

  const headerActions = (
    <div className="flex items-center gap-1">
      {actions}
      {maxBtn}
    </div>
  )

  const cardBody = (
    <>
      {!collapsible ? (
        <Card className={cn("bg-white shadow-sm border-gray-200 w-full", className)}>
          <CardHeader className={headerClassName}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {icon}
                <div className="min-w-0">
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    {title}
                    {badge}
                  </CardTitle>
                  {description && <CardDescription>{description}</CardDescription>}
                </div>
              </div>
              {headerActions}
            </div>
          </CardHeader>
          <CardContent className={contentClassName}>{children}</CardContent>
        </Card>
      ) : (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <Card className={cn("bg-white shadow-sm border-gray-200 w-full", className)}>
            <CardHeader className={cn("cursor-pointer", headerClassName)}>
              <div className="flex items-center justify-between w-full gap-2">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 min-w-0 flex-1 text-left"
                    aria-expanded={isExpanded}
                  >
                    {icon}
                    <div className="min-w-0">
                      <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        {title}
                        {badge}
                      </CardTitle>
                      {description && <CardDescription>{description}</CardDescription>}
                    </div>
                  </button>
                </CollapsibleTrigger>
                <div className="flex items-center gap-1">
                  {headerActions}
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={isExpanded ? "Collapse" : "Expand"}>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>
            </CardHeader>
            <CollapsibleContent>
              <CardContent className={contentClassName}>{children}</CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </>
  )

  if (!maximizable) return cardBody

  return (
    <>
      {cardBody}
      <Dialog open={isMaximized} onOpenChange={setIsMaximized}>
        {/*
         * Force a near-full-viewport modal so users can actually drill into
         * the underlying data — the default `sm:max-w-lg` is far too narrow
         * for tables of debriefs / work items / etc.
         */}
        <DialogContent
          className="!max-w-[min(1400px,95vw)] w-[95vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
          showCloseButton={false}
        >
          <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0 border-b px-6 py-4">
            <div className="flex items-center gap-2 min-w-0">
              {icon}
              <DialogTitle className="text-xl font-semibold flex items-center gap-2 truncate">
                {title}
                {badge}
              </DialogTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setIsMaximized(false)}
              aria-label="Close expanded view"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-6">{expandedContent ?? children}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}
