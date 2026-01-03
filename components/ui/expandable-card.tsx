"use client"

import * as React from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

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
}: ExpandableCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded)

  if (!collapsible) {
    return (
      <Card className={cn("bg-white shadow-sm border-gray-200", className)}>
        <CardHeader className={headerClassName}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {icon}
              <div>
                <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  {title}
                  {badge}
                </CardTitle>
                {description && <CardDescription>{description}</CardDescription>}
              </div>
            </div>
            {actions}
          </div>
        </CardHeader>
        <CardContent className={contentClassName}>{children}</CardContent>
      </Card>
    )
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className={cn("bg-white shadow-sm border-gray-200", className)}>
        <CardHeader className={cn("cursor-pointer", headerClassName)}>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                {icon}
                <div>
                  <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    {title}
                    {badge}
                  </CardTitle>
                  {description && <CardDescription>{description}</CardDescription>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {actions}
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className={contentClassName}>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
