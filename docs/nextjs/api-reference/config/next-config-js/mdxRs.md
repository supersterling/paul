# mdxRs
@doc-version: 16.1.6
@last-updated: 2025-11-05



> This feature is currently experimental and subject to change, it is not recommended for production.

For experimental use with `@next/mdx`. Compiles MDX files using the new Rust compiler.

```js filename="next.config.js"
const withMDX = require('@next/mdx')()

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['ts', 'tsx', 'mdx'],
  experimental: {
    mdxRs: true,
  },
}

module.exports = withMDX(nextConfig)
```
---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)