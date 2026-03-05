import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

const config = {
  reactStrictMode: true,
  transpilePackages: ['ajv'],
};

export default withMDX(config);
