import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The local preview proxy and loopback browser tests need access to dev assets.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.e2b.app"],
  devIndicators: false,
};

export default nextConfig;
