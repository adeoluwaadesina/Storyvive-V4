/** @type {import('next').NextConfig} */
const nextConfig = {
  // src/canon, src/generate, and lib use NodeNext-style ".js"-suffixed relative
  // imports (required for tsx/Node ESM in test-canon.ts). Webpack doesn't map
  // ".js" -> ".ts" by default the way tsx/tsc do, so tell it to.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
