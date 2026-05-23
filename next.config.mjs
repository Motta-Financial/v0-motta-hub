/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  /**
   * Per-path response headers.
   *
   * The /zoom/embed/* tree is served as the "Home URL" of the Zoom App
   * (Marketplace > Features > Surface). Zoom's validator scans that URL
   * for the OWASP-recommended trio and refuses to publish the app if
   * any are missing:
   *   - X-Content-Type-Options: nosniff
   *   - Content-Security-Policy
   *   - Referrer-Policy
   *
   * The CSP also needs `frame-ancestors https://*.zoom.us` so the page
   * can be iframed by the Zoom desktop client (otherwise the embed
   * surface renders blank), and `script-src https://appssdk.zoom.us`
   * so the Zoom Apps SDK can load when we eventually wire it up.
   *
   * `'unsafe-inline'` and `'unsafe-eval'` are present because Next.js
   * inlines runtime code; this matches the default Next.js CSP advice.
   * If we later move the embed page off Next.js, these can be tightened.
   */
  async headers() {
    return [
      {
        source: "/zoom/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://appssdk.zoom.us",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.zoom.us https://appssdk.zoom.us",
              "frame-ancestors 'self' https://*.zoom.us",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      {
        source: "/api/alfred/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "https://alfred.motta.cpa" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Authorization, Content-Type" },
          { key: "Access-Control-Allow-Credentials", value: "true" },
        ],
      },
      /**
       * Public embed pages — these are designed to be iframed from the
       * marketing site at https://motta.cpa (and its Vercel preview
       * URLs). The corresponding JSON APIs live under /api/public/*
       * and have their own CORS allowlist (see lib/cors.ts) since the
       * website team's preview domains are dynamic.
       *
       * frame-ancestors here is the iframe equivalent of CORS — it
       * tells the browser which origins may embed this page. We allow
       * 'self' (so /clients/[id] can preview the embed for QA), the
       * production marketing domain, and the Vercel preview pattern
       * for the public-website project.
       */
      {
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "frame-ancestors 'self' https://motta.cpa https://*.motta.cpa https://*.vercel.app https://www.mottafinancial.com",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ]
  },
}

export default nextConfig
