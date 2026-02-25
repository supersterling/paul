# next.config.js
@doc-version: 16.1.6
@last-updated: 2025-11-04


Next.js can be configured through a `next.config.js` file in the root of your project directory (for example, by `package.json`) with a default export.

```js filename="next.config.js"
// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
}

module.exports = nextConfig
```

## ECMAScript Modules

`next.config.js` is a regular Node.js module, not a JSON file. It gets used by the Next.js server and build phases, and it's not included in the browser build.

If you need [ECMAScript modules](https://nodejs.org/api/esm.html), you can use `next.config.mjs`:

```js filename="next.config.mjs"
// @ts-check

/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  /* config options here */
}

export default nextConfig
```

> **Good to know**: `next.config` with the `.cjs` or `.cts` extensions are currently **not** supported.

## Configuration as a Function

You can also use a function:

```js filename="next.config.mjs"
// @ts-check

export default (phase, { defaultConfig }) => {
  /**
   * @type {import('next').NextConfig}
   */
  const nextConfig = {
    /* config options here */
  }
  return nextConfig
}
```

### Async Configuration

Since Next.js 12.1.0, you can use an async function:

```js filename="next.config.js"
// @ts-check

module.exports = async (phase, { defaultConfig }) => {
  /**
   * @type {import('next').NextConfig}
   */
  const nextConfig = {
    /* config options here */
  }
  return nextConfig
}
```

### Phase

`phase` is the current context in which the configuration is loaded. You can see the [available phases](https://github.com/vercel/next.js/blob/5e6b008b561caf2710ab7be63320a3d549474a5b/packages/next/shared/lib/constants.ts#L19-L23). Phases can be imported from `next/constants`:

```js filename="next.config.js"
// @ts-check

const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

module.exports = (phase, { defaultConfig }) => {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      /* development only config options here */
    }
  }

  return {
    /* config options for all phases except development here */
  }
}
```

## TypeScript

If you are using TypeScript in your project, you can use `next.config.ts` to use TypeScript in your configuration:

```ts filename="next.config.ts"
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
}

export default nextConfig
```

The commented lines are the place where you can put the configs allowed by `next.config.js`, which are [defined in this file](https://github.com/vercel/next.js/blob/canary/packages/next/src/server/config-shared.ts).

However, none of the configs are required, and it's not necessary to understand what each config does. Instead, search for the features you need to enable or modify in this section and they will show you what to do.

> Avoid using new JavaScript features not available in your target Node.js version. `next.config.js` will not be parsed by Webpack or Babel.

This page documents all the available configuration options:

## Unit Testing (experimental)

Starting in Next.js 15.1, the `next/experimental/testing/server` package contains utilities to help unit test `next.config.js` files.

The `unstable_getResponseFromNextConfig` function runs the [`headers`](/docs/app/api-reference/config/next-config-js/headers), [`redirects`](/docs/app/api-reference/config/next-config-js/redirects), and [`rewrites`](/docs/app/api-reference/config/next-config-js/rewrites) functions from `next.config.js` with the provided request information and returns `NextResponse` with the results of the routing.

> The response from `unstable_getResponseFromNextConfig` only considers `next.config.js` fields and does not consider proxy or filesystem routes, so the result in production may be different than the unit test.

```js
import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from 'next/experimental/testing/server'

const response = await unstable_getResponseFromNextConfig({
  url: 'https://nextjs.org/test',
  nextConfig: {
    async redirects() {
      return [{ source: '/test', destination: '/test2', permanent: false }]
    },
  },
})
expect(response.status).toEqual(307)
expect(getRedirectUrl(response)).toEqual('https://nextjs.org/test2')
```

- [experimental.adapterPath](/docs/app/api-reference/config/next-config-js/adapterPath)
  - Configure a custom adapter for Next.js to hook into the build process with modifyConfig and onBuildComplete callbacks.
- [allowedDevOrigins](/docs/app/api-reference/config/next-config-js/allowedDevOrigins)
  - Use `allowedDevOrigins` to configure additional origins that can request the dev server.
- [appDir](/docs/app/api-reference/config/next-config-js/appDir)
  - Enable the App Router to use layouts, streaming, and more.
- [assetPrefix](/docs/app/api-reference/config/next-config-js/assetPrefix)
  - Learn how to use the assetPrefix config option to configure your CDN.
- [authInterrupts](/docs/app/api-reference/config/next-config-js/authInterrupts)
  - Learn how to enable the experimental `authInterrupts` configuration option to use `forbidden` and `unauthorized`.
- [basePath](/docs/app/api-reference/config/next-config-js/basePath)
  - Use `basePath` to deploy a Next.js application under a sub-path of a domain.
- [browserDebugInfoInTerminal](/docs/app/api-reference/config/next-config-js/browserDebugInfoInTerminal)
  - Forward browser console logs and errors to your terminal during development.
- [cacheComponents](/docs/app/api-reference/config/next-config-js/cacheComponents)
  - Learn how to enable the cacheComponents flag in Next.js.
- [cacheHandlers](/docs/app/api-reference/config/next-config-js/cacheHandlers)
  - Configure custom cache handlers for use cache directives in Next.js.
- [cacheLife](/docs/app/api-reference/config/next-config-js/cacheLife)
  - Learn how to set up cacheLife configurations in Next.js.
- [compress](/docs/app/api-reference/config/next-config-js/compress)
  - Next.js provides gzip compression to compress rendered content and static files, it only works with the server target. Learn more about it here.
- [crossOrigin](/docs/app/api-reference/config/next-config-js/crossOrigin)
  - Use the `crossOrigin` option to add a crossOrigin tag on the `script` tags generated by `next/script`.
- [cssChunking](/docs/app/api-reference/config/next-config-js/cssChunking)
  - Use the `cssChunking` option to control how CSS files are chunked in your Next.js application.
- [devIndicators](/docs/app/api-reference/config/next-config-js/devIndicators)
  - Configuration options for the on-screen indicator that gives context about the current route you're viewing during development.
- [distDir](/docs/app/api-reference/config/next-config-js/distDir)
  - Set a custom build directory to use instead of the default .next directory.
- [env](/docs/app/api-reference/config/next-config-js/env)
  - Learn to add and access environment variables in your Next.js application at build time.
- [expireTime](/docs/app/api-reference/config/next-config-js/expireTime)
  - Customize stale-while-revalidate expire time for ISR enabled pages.
- [exportPathMap](/docs/app/api-reference/config/next-config-js/exportPathMap)
  - Customize the pages that will be exported as HTML files when using `next export`.
- [generateBuildId](/docs/app/api-reference/config/next-config-js/generateBuildId)
  - Configure the build id, which is used to identify the current build in which your application is being served.
- [generateEtags](/docs/app/api-reference/config/next-config-js/generateEtags)
  - Next.js will generate etags for every page by default. Learn more about how to disable etag generation here.
- [headers](/docs/app/api-reference/config/next-config-js/headers)
  - Add custom HTTP headers to your Next.js app.
- [htmlLimitedBots](/docs/app/api-reference/config/next-config-js/htmlLimitedBots)
  - Specify a list of user agents that should receive blocking metadata.
- [httpAgentOptions](/docs/app/api-reference/config/next-config-js/httpAgentOptions)
  - Next.js will automatically use HTTP Keep-Alive by default. Learn more about how to disable HTTP Keep-Alive here.
- [images](/docs/app/api-reference/config/next-config-js/images)
  - Custom configuration for the next/image loader
- [cacheHandler](/docs/app/api-reference/config/next-config-js/incrementalCacheHandlerPath)
  - Configure the Next.js cache used for storing and revalidating data to use any external service like Redis, Memcached, or others.
- [inlineCss](/docs/app/api-reference/config/next-config-js/inlineCss)
  - Enable inline CSS support.
- [isolatedDevBuild](/docs/app/api-reference/config/next-config-js/isolatedDevBuild)
  - Use isolated build outputs for development server to prevent conflicts with production builds.
- [logging](/docs/app/api-reference/config/next-config-js/logging)
  - Configure how data fetches are logged to the console when running Next.js in development mode.
- [mdxRs](/docs/app/api-reference/config/next-config-js/mdxRs)
  - Use the new Rust compiler to compile MDX files in the App Router.
- [onDemandEntries](/docs/app/api-reference/config/next-config-js/onDemandEntries)
  - Configure how Next.js will dispose and keep in memory pages created in development.
- [optimizePackageImports](/docs/app/api-reference/config/next-config-js/optimizePackageImports)
  - API Reference for optimizePackageImports Next.js Config Option
- [output](/docs/app/api-reference/config/next-config-js/output)
  - Next.js automatically traces which files are needed by each page to allow for easy deployment of your application. Learn how it works here.
- [pageExtensions](/docs/app/api-reference/config/next-config-js/pageExtensions)
  - Extend the default page extensions used by Next.js when resolving pages in the Pages Router.
- [poweredByHeader](/docs/app/api-reference/config/next-config-js/poweredByHeader)
  - Next.js will add the `x-powered-by` header by default. Learn to opt-out of it here.
- [productionBrowserSourceMaps](/docs/app/api-reference/config/next-config-js/productionBrowserSourceMaps)
  - Enables browser source map generation during the production build.
- [proxyClientMaxBodySize](/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize)
  - Configure the maximum request body size when using proxy.
- [reactCompiler](/docs/app/api-reference/config/next-config-js/reactCompiler)
  - Enable the React Compiler to automatically optimize component rendering.
- [reactMaxHeadersLength](/docs/app/api-reference/config/next-config-js/reactMaxHeadersLength)
  - The maximum length of the headers that are emitted by React and added to the response.
- [reactStrictMode](/docs/app/api-reference/config/next-config-js/reactStrictMode)
  - The complete Next.js runtime is now Strict Mode-compliant, learn how to opt-in
- [redirects](/docs/app/api-reference/config/next-config-js/redirects)
  - Add redirects to your Next.js app.
- [rewrites](/docs/app/api-reference/config/next-config-js/rewrites)
  - Add rewrites to your Next.js app.
- [sassOptions](/docs/app/api-reference/config/next-config-js/sassOptions)
  - Configure Sass options.
- [serverActions](/docs/app/api-reference/config/next-config-js/serverActions)
  - Configure Server Actions behavior in your Next.js application.
- [serverComponentsHmrCache](/docs/app/api-reference/config/next-config-js/serverComponentsHmrCache)
  - Configure whether fetch responses in Server Components are cached across HMR refresh requests.
- [serverExternalPackages](/docs/app/api-reference/config/next-config-js/serverExternalPackages)
  - Opt-out specific dependencies from the Server Components bundling and use native Node.js `require`.
- [staleTimes](/docs/app/api-reference/config/next-config-js/staleTimes)
  - Learn how to override the invalidation time of the Client Router Cache.
- [staticGeneration*](/docs/app/api-reference/config/next-config-js/staticGeneration)
  - Learn how to configure static generation in your Next.js application.
- [taint](/docs/app/api-reference/config/next-config-js/taint)
  - Enable tainting Objects and Values.
- [trailingSlash](/docs/app/api-reference/config/next-config-js/trailingSlash)
  - Configure Next.js pages to resolve with or without a trailing slash.
- [transpilePackages](/docs/app/api-reference/config/next-config-js/transpilePackages)
  - Automatically transpile and bundle dependencies from local packages (like monorepos) or from external dependencies (`node_modules`).
- [turbopack](/docs/app/api-reference/config/next-config-js/turbopack)
  - Configure Next.js with Turbopack-specific options
- [turbopackFileSystemCache](/docs/app/api-reference/config/next-config-js/turbopackFileSystemCache)
  - Learn how to enable FileSystem Caching for Turbopack builds
- [typedRoutes](/docs/app/api-reference/config/next-config-js/typedRoutes)
  - Enable support for statically typed links.
- [typescript](/docs/app/api-reference/config/next-config-js/typescript)
  - Configure how Next.js handles TypeScript errors during production builds and specify a custom tsconfig file.
- [urlImports](/docs/app/api-reference/config/next-config-js/urlImports)
  - Configure Next.js to allow importing modules from external URLs.
- [useLightningcss](/docs/app/api-reference/config/next-config-js/useLightningcss)
  - Enable experimental support for Lightning CSS.
- [viewTransition](/docs/app/api-reference/config/next-config-js/viewTransition)
  - Enable ViewTransition API from React in App Router
- [webpack](/docs/app/api-reference/config/next-config-js/webpack)
  - Learn how to customize the webpack config used by Next.js
- [webVitalsAttribution](/docs/app/api-reference/config/next-config-js/webVitalsAttribution)
  - Learn how to use the webVitalsAttribution option to pinpoint the source of Web Vitals issues.

---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)