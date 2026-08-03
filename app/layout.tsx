import type React from "react"
import type { Metadata } from "next"
import { Inter, Source_Code_Pro } from "next/font/google"
import "./globals.css"
import { AlfredChatTrigger } from "@/components/alfred-chat-trigger"
import { AuthHashForwarder } from "@/components/auth-hash-forwarder"
import { UserProvider } from "@/contexts/user-context"
import { KarbonWorkItemsProvider } from "@/contexts/karbon-work-items-context"
import { Toaster } from "sonner"

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
  title: "ALFRED Hub",
  description: "Internal operations Ai for Motta Financial professionals",
  applicationName: "ALFRED Hub",
  authors: [{ name: "Motta Financial" }],
  generator: "v0.app",
  manifest: "/manifest.json",
  icons: {
    // Browsers walk this list in order and pick the first format they
    // support. Listing the Motta lotus PNG first makes it the favicon
    // everywhere; the legacy SVG stays as a fallback for older clients.
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: [{ url: "/icon.png", type: "image/png" }],
    apple: [
      { url: "/icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ALFRED Hub",
  },
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#7A8B69",
}

// NOTE: The root layout sits at the top of every route's chunk graph, so
// when a multi-file branch sync happens mid-session (e.g. a v0 PR merge)
// the dev server can end up with a build manifest that references chunk
// hashes the file watcher has already invalidated, surfacing as a
// `ChunkLoadError` originating from RootLayout. Editing this file forces
// a clean re-bundle of the layout's client-component dependencies
// (UserProvider, KarbonWorkItemsProvider, AlfredChatTrigger,
// AuthHashForwarder, Toaster) so that the manifest the browser fetches
// on the next request is consistent with what's actually on disk.

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${sourceCodePro.variable} antialiased`}>
      <body>
        {/* Catches Supabase implicit-flow recovery / invite hash fragments
            on any landing page and forwards them to /auth/reset-password. */}
        <AuthHashForwarder />
        <UserProvider>
          <KarbonWorkItemsProvider>
            {children}
            <AlfredChatTrigger />
            <Toaster richColors position="top-right" />
          </KarbonWorkItemsProvider>
        </UserProvider>
      </body>
    </html>
  )
}
