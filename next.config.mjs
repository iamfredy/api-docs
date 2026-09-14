import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const config = {
  reactStrictMode: true,
  transpilePackages: ['ajv'],
  experimental: {
    serverActions: {
      bodySizeLimit: '4mb',
    },
  },
  // OpenNext/Slate traces only statically visible files. These folders are read
  // with fs at runtime, so they must be included explicitly or the origin 503s.
  outputFileTracingIncludes: {
    '/*': ['./oas/**/*', './resources/oas/**/*'],
  },
  async headers() {
    return [
      {
        source: '/oas-preview-frame/:id',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-store, no-cache, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default withMDX(config);
