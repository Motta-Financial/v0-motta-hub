import { handleUpload } from "@vercel/blob/client"
import { type NextRequest, NextResponse } from "next/server"

const MAX_PDF_BYTES = 25 * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const jsonResponse = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (pathname) => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: MAX_PDF_BYTES,
        addRandomSuffix: true,
        tokenPayload: JSON.stringify({ pathname }),
      }),
      onUploadCompleted: async () => {},
    })

    return NextResponse.json(jsonResponse)
  } catch (error) {
    console.error("[motta-alliance/upload-token] error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to authorize PDF upload" },
      { status: 500 },
    )
  }
}
