"use client"

import { useEffect } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.log("[v0] Global error boundary caught:", error.message, error.stack)
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-xl w-full space-y-4">
        <h2 className="text-2xl font-bold text-red-600">Something went wrong</h2>
        <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto whitespace-pre-wrap max-h-96">
          {error.message}
          {"\n\n"}
          {error.stack}
        </pre>
        {error.digest && (
          <p className="text-sm text-gray-500">Error digest: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}
