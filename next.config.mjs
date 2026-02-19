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
  webpack: (config, { isServer }) => {
    // Increase the threshold for the big string serialization warning
    // to suppress the "Serializing big strings (130kiB)" cache warning
    if (config.cache && typeof config.cache === "object") {
      config.cache = {
        ...config.cache,
        maxMemoryGenerations: 1,
      }
    }
    return config
  },
}

export default nextConfig
