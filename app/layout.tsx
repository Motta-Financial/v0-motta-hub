import type React from "react"
import type { Metadata } from "next"
import { Inter, Source_Code_Pro } from "next/font/google"
import "./globals.css"
import { AlfredChatTrigger } from "@/components/alfred-chat-trigger"
import { UserProvider } from "@/contexts/user-context"
import { KarbonWorkItemsProvider } from "@/contexts/karbon-work-items-context"

console.log("[v0] layout.tsx module loaded")

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
})

const sourceCodePro = Source_Code_Pro({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source-code-pro",
})

export const metadata: Metadata = {
  title: "Motta Financial Dashboard",
  description: "Internal dashboard for Motta Financial professionals",
  generator: "v0.app",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceCodePro.variable} antialiased`}>
      <body>
        <UserProvider>
          <KarbonWorkItemsProvider>
            {children}
            <AlfredChatTrigger />
          </KarbonWorkItemsProvider>
        </UserProvider>
      </body>
    </html>
  )
}
