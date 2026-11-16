import dotenv from "dotenv";
import type { NextConfig } from "next";
import { resolve } from "node:path";

dotenv.config({ path: resolve(__dirname, "../../.env"), quiet: true });

if (!process.env.NEXT_PUBLIC_API_BASE_URL) {
  throw new Error(
    "NEXT_PUBLIC_API_BASE_URL is required for the web application.",
  );
}

const nextConfig: NextConfig = {};

export default nextConfig;
