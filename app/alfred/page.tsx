"use client"

import { AlfredChat } from "@/components/alfred-chat"

// Standalone, full-window ALFRED chat. Opened via the "Open in new
// window" control on the floating widget (window.open("/alfred", …)).
// UserProvider / KarbonWorkItemsProvider wrap the whole app at the root
// layout, so the chat has the same identity + context it does inline.
export default function AlfredWindowPage() {
  return (
    <main className="fixed inset-0 flex flex-col bg-background">
      <AlfredChat
        fullPage
        isOpen
        // In a dedicated window, "close" means close the window. If the
        // browser blocks window.close() (e.g. the tab wasn't script-
        // opened), fall back to navigating home.
        onClose={() => {
          window.close()
          // Give the close a tick; if we're still here, go home.
          setTimeout(() => {
            if (!window.closed) window.location.href = "/"
          }, 150)
        }}
      />
    </main>
  )
}
