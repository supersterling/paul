# staticGeneration*
@doc-version: 16.1.6
@last-updated: 2025-06-16



> This feature is currently experimental and subject to change, it is not recommended for production.

The `staticGeneration*` options allow you to configure the Static Generation process for advanced use cases.

```ts filename="next.config.ts" switcher
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 8,
    staticGenerationMinPagesPerWorker: 25,
  },
}

export default nextConfig
```

```js filename="next.config.js" switcher
const nextConfig = {
  experimental: {
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 8,
    staticGenerationMinPagesPerWorker: 25,
  },
}

export default nextConfig
```

## Config Options

The following options are available:

* `staticGenerationRetryCount`: The number of times to retry a failed page generation before failing the build.
* `staticGenerationMaxConcurrency`: The maximum number of pages to be processed per worker.
* `staticGenerationMinPagesPerWorker`: The minimum number of pages to be processed before starting a new worker.
---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)