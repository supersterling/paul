---
title: Next.js API Reference
---

# Next.js API Reference

*147 pages scraped on 2026-02-06*

| Section | Pages |
| --- | --- |
| api-reference | 1 |
| api-reference/directives | 6 |
| api-reference/components | 6 |
| api-reference/file-conventions | 28 |
| api-reference/functions | 38 |
| api-reference/config | 63 |
| api-reference/cli | 3 |
| api-reference/edge | 1 |
| api-reference/turbopack | 1 |

---

## api-reference

- [API Reference](./api-reference.md) — Next.js API Reference for the App Router.

## api-reference/directives

- [Directives](./api-reference/directives.md) — Directives are used to modify the behavior of your Next.js application.
- [use cache](./api-reference/directives/use-cache.md) — Learn how to use the "use cache" directive to cache data in your Next.js application.
- [use cache: private](./api-reference/directives/use-cache-private.md) — Learn how to use the "use cache: private" directive to cache functions that access runtime request APIs.
- [use cache: remote](./api-reference/directives/use-cache-remote.md) — Learn how to use the "use cache: remote" directive for persistent, shared caching using remote cache handlers.
- [use client](./api-reference/directives/use-client.md) — Learn how to use the use client directive to render a component on the client.
- [use server](./api-reference/directives/use-server.md) — Learn how to use the use server directive to execute code on the server.

## api-reference/components

- [Components](./api-reference/components.md) — API Reference for Next.js built-in components.
- [Font](./api-reference/components/font.md) — Optimizing loading web fonts with the built-in `next/font` loaders.
- [Form Component](./api-reference/components/form.md) — Learn how to use the `<Form>` component to handle form submissions and search params updates with client-side navigation.
- [Image Component](./api-reference/components/image.md) — Optimize Images in your Next.js Application using the built-in `next/image` Component.
- [Link Component](./api-reference/components/link.md) — Enable fast client-side navigation with the built-in `next/link` component.
- [Script Component](./api-reference/components/script.md) — Optimize third-party scripts in your Next.js application using the built-in `next/script` Component.

## api-reference/file-conventions

- [File-system conventions](./api-reference/file-conventions.md) — API Reference for Next.js file-system conventions.
- [default.js](./api-reference/file-conventions/default.md) — API Reference for the default.js file.
- [Dynamic Segments](./api-reference/file-conventions/dynamic-routes.md) — Dynamic Route Segments can be used to programmatically generate route segments from dynamic data.
- [error.js](./api-reference/file-conventions/error.md) — API reference for the error.js special file.
- [forbidden.js](./api-reference/file-conventions/forbidden.md) — API reference for the forbidden.js special file.
- [instrumentation.js](./api-reference/file-conventions/instrumentation.md) — API reference for the instrumentation.js file.
- [instrumentation-client.js](./api-reference/file-conventions/instrumentation-client.md) — Learn how to add client-side instrumentation to track and monitor your Next.js application's frontend performance.
- [Intercepting Routes](./api-reference/file-conventions/intercepting-routes.md) — Use intercepting routes to load a new route within the current layout while masking the browser URL, useful for advanced routing patterns such as modals.
- [layout.js](./api-reference/file-conventions/layout.md) — API reference for the layout.js file.
- [loading.js](./api-reference/file-conventions/loading.md) — API reference for the loading.js file.
- [mdx-components.js](./api-reference/file-conventions/mdx-components.md) — API reference for the mdx-components.js file.
- [not-found.js](./api-reference/file-conventions/not-found.md) — API reference for the not-found.js file.
- [page.js](./api-reference/file-conventions/page.md) — API reference for the page.js file.
- [Parallel Routes](./api-reference/file-conventions/parallel-routes.md) — Simultaneously render one or more pages in the same view that can be navigated independently. A pattern for highly dynamic applications.
- [proxy.js](./api-reference/file-conventions/proxy.md) — API reference for the proxy.js file.
- [public](./api-reference/file-conventions/public-folder.md) — Next.js allows you to serve static files, like images, in the public directory. You can learn how it works here.
- [route.js](./api-reference/file-conventions/route.md) — API reference for the route.js special file.
- [Route Groups](./api-reference/file-conventions/route-groups.md) — Route Groups can be used to partition your Next.js application into different sections.
- [Route Segment Config](./api-reference/file-conventions/route-segment-config.md) — Learn about how to configure options for Next.js route segments.
- [src](./api-reference/file-conventions/src-folder.md) — Save pages under the `src` folder as an alternative to the root `pages` directory.
- [template.js](./api-reference/file-conventions/template.md) — API Reference for the template.js file.
- [unauthorized.js](./api-reference/file-conventions/unauthorized.md) — API reference for the unauthorized.js special file.
- [Metadata Files](./api-reference/file-conventions/metadata.md) — API documentation for the metadata file conventions.
- [favicon, icon, and apple-icon](./api-reference/file-conventions/metadata/app-icons.md) — API Reference for the Favicon, Icon and Apple Icon file conventions.
- [manifest.json](./api-reference/file-conventions/metadata/manifest.md) — API Reference for manifest.json file.
- [opengraph-image and twitter-image](./api-reference/file-conventions/metadata/opengraph-image.md) — API Reference for the Open Graph Image and Twitter Image file conventions.
- [robots.txt](./api-reference/file-conventions/metadata/robots.md) — API Reference for robots.txt file.
- [sitemap.xml](./api-reference/file-conventions/metadata/sitemap.md) — API Reference for the sitemap.xml file.

## api-reference/functions

- [Functions](./api-reference/functions.md) — API Reference for Next.js Functions and Hooks.
- [after](./api-reference/functions/after.md) — API Reference for the after function.
- [cacheLife](./api-reference/functions/cacheLife.md) — Learn how to use the cacheLife function to set the cache expiration time for a cached function or component.
- [cacheTag](./api-reference/functions/cacheTag.md) — Learn how to use the cacheTag function to manage cache invalidation in your Next.js application.
- [connection](./api-reference/functions/connection.md) — API Reference for the connection function.
- [cookies](./api-reference/functions/cookies.md) — API Reference for the cookies function.
- [draftMode](./api-reference/functions/draft-mode.md) — API Reference for the draftMode function.
- [fetch](./api-reference/functions/fetch.md) — API reference for the extended fetch function.
- [forbidden](./api-reference/functions/forbidden.md) — API Reference for the forbidden function.
- [generateImageMetadata](./api-reference/functions/generate-image-metadata.md) — Learn how to generate multiple images in a single Metadata API special file.
- [generateMetadata](./api-reference/functions/generate-metadata.md) — Learn how to add Metadata to your Next.js application for improved search engine optimization (SEO) and web shareability.
- [generateSitemaps](./api-reference/functions/generate-sitemaps.md) — Learn how to use the generateSiteMaps function to create multiple sitemaps for your application.
- [generateStaticParams](./api-reference/functions/generate-static-params.md) — API reference for the generateStaticParams function.
- [generateViewport](./api-reference/functions/generate-viewport.md) — API Reference for the generateViewport function.
- [headers](./api-reference/functions/headers.md) — API reference for the headers function.
- [ImageResponse](./api-reference/functions/image-response.md) — API Reference for the ImageResponse constructor.
- [NextRequest](./api-reference/functions/next-request.md) — API Reference for NextRequest.
- [NextResponse](./api-reference/functions/next-response.md) — API Reference for NextResponse.
- [notFound](./api-reference/functions/not-found.md) — API Reference for the notFound function.
- [permanentRedirect](./api-reference/functions/permanentRedirect.md) — API Reference for the permanentRedirect function.
- [redirect](./api-reference/functions/redirect.md) — API Reference for the redirect function.
- [refresh](./api-reference/functions/refresh.md) — API Reference for the refresh function.
- [revalidatePath](./api-reference/functions/revalidatePath.md) — API Reference for the revalidatePath function.
- [revalidateTag](./api-reference/functions/revalidateTag.md) — API Reference for the revalidateTag function.
- [unauthorized](./api-reference/functions/unauthorized.md) — API Reference for the unauthorized function.
- [unstable_cache](./api-reference/functions/unstable_cache.md) — API Reference for the unstable_cache function.
- [unstable_noStore](./api-reference/functions/unstable_noStore.md) — API Reference for the unstable_noStore function.
- [unstable_rethrow](./api-reference/functions/unstable_rethrow.md) — API Reference for the unstable_rethrow function.
- [updateTag](./api-reference/functions/updateTag.md) — API Reference for the updateTag function.
- [useLinkStatus](./api-reference/functions/use-link-status.md) — API Reference for the useLinkStatus hook.
- [useParams](./api-reference/functions/use-params.md) — API Reference for the useParams hook.
- [usePathname](./api-reference/functions/use-pathname.md) — API Reference for the usePathname hook.
- [useReportWebVitals](./api-reference/functions/use-report-web-vitals.md) — API Reference for the useReportWebVitals function.
- [useRouter](./api-reference/functions/use-router.md) — API reference for the useRouter hook.
- [useSearchParams](./api-reference/functions/use-search-params.md) — API Reference for the useSearchParams hook.
- [useSelectedLayoutSegment](./api-reference/functions/use-selected-layout-segment.md) — API Reference for the useSelectedLayoutSegment hook.
- [useSelectedLayoutSegments](./api-reference/functions/use-selected-layout-segments.md) — API Reference for the useSelectedLayoutSegments hook.
- [userAgent](./api-reference/functions/userAgent.md) — The userAgent helper extends the Web Request API with additional properties and methods to interact with the user agent object from the request.

## api-reference/config

- [Configuration](./api-reference/config.md) — Learn how to configure Next.js applications.
- [next.config.js](./api-reference/config/next-config-js.md) — Learn how to configure your application with next.config.js.
- [experimental.adapterPath](./api-reference/config/next-config-js/adapterPath.md) — Configure a custom adapter for Next.js to hook into the build process with modifyConfig and onBuildComplete callbacks.
- [allowedDevOrigins](./api-reference/config/next-config-js/allowedDevOrigins.md) — Use `allowedDevOrigins` to configure additional origins that can request the dev server.
- [appDir](./api-reference/config/next-config-js/appDir.md) — Enable the App Router to use layouts, streaming, and more.
- [assetPrefix](./api-reference/config/next-config-js/assetPrefix.md) — Learn how to use the assetPrefix config option to configure your CDN.
- [authInterrupts](./api-reference/config/next-config-js/authInterrupts.md) — Learn how to enable the experimental `authInterrupts` configuration option to use `forbidden` and `unauthorized`.
- [basePath](./api-reference/config/next-config-js/basePath.md) — Use `basePath` to deploy a Next.js application under a sub-path of a domain.
- [browserDebugInfoInTerminal](./api-reference/config/next-config-js/browserDebugInfoInTerminal.md) — Forward browser console logs and errors to your terminal during development.
- [cacheComponents](./api-reference/config/next-config-js/cacheComponents.md) — Learn how to enable the cacheComponents flag in Next.js.
- [cacheHandlers](./api-reference/config/next-config-js/cacheHandlers.md) — Configure custom cache handlers for use cache directives in Next.js.
- [cacheLife](./api-reference/config/next-config-js/cacheLife.md) — Learn how to set up cacheLife configurations in Next.js.
- [compress](./api-reference/config/next-config-js/compress.md) — Next.js provides gzip compression to compress rendered content and static files, it only works with the server target. Learn more about it here.
- [crossOrigin](./api-reference/config/next-config-js/crossOrigin.md) — Use the `crossOrigin` option to add a crossOrigin tag on the `script` tags generated by `next/script`.
- [cssChunking](./api-reference/config/next-config-js/cssChunking.md) — Use the `cssChunking` option to control how CSS files are chunked in your Next.js application.
- [devIndicators](./api-reference/config/next-config-js/devIndicators.md) — Configuration options for the on-screen indicator that gives context about the current route you're viewing during development.
- [distDir](./api-reference/config/next-config-js/distDir.md) — Set a custom build directory to use instead of the default .next directory.
- [env](./api-reference/config/next-config-js/env.md) — Learn to add and access environment variables in your Next.js application at build time.
- [expireTime](./api-reference/config/next-config-js/expireTime.md) — Customize stale-while-revalidate expire time for ISR enabled pages.
- [exportPathMap](./api-reference/config/next-config-js/exportPathMap.md) — Customize the pages that will be exported as HTML files when using `next export`.
- [generateBuildId](./api-reference/config/next-config-js/generateBuildId.md) — Configure the build id, which is used to identify the current build in which your application is being served.
- [generateEtags](./api-reference/config/next-config-js/generateEtags.md) — Next.js will generate etags for every page by default. Learn more about how to disable etag generation here.
- [headers](./api-reference/config/next-config-js/headers.md) — Add custom HTTP headers to your Next.js app.
- [htmlLimitedBots](./api-reference/config/next-config-js/htmlLimitedBots.md) — Specify a list of user agents that should receive blocking metadata.
- [httpAgentOptions](./api-reference/config/next-config-js/httpAgentOptions.md) — Next.js will automatically use HTTP Keep-Alive by default. Learn more about how to disable HTTP Keep-Alive here.
- [images](./api-reference/config/next-config-js/images.md) — Custom configuration for the next/image loader
- [cacheHandler](./api-reference/config/next-config-js/incrementalCacheHandlerPath.md) — Configure the Next.js cache used for storing and revalidating data to use any external service like Redis, Memcached, or others.
- [inlineCss](./api-reference/config/next-config-js/inlineCss.md) — Enable inline CSS support.
- [isolatedDevBuild](./api-reference/config/next-config-js/isolatedDevBuild.md) — Use isolated build outputs for development server to prevent conflicts with production builds.
- [logging](./api-reference/config/next-config-js/logging.md) — Configure how data fetches are logged to the console when running Next.js in development mode.
- [mdxRs](./api-reference/config/next-config-js/mdxRs.md) — Use the new Rust compiler to compile MDX files in the App Router.
- [onDemandEntries](./api-reference/config/next-config-js/onDemandEntries.md) — Configure how Next.js will dispose and keep in memory pages created in development.
- [optimizePackageImports](./api-reference/config/next-config-js/optimizePackageImports.md) — API Reference for optimizePackageImports Next.js Config Option
- [output](./api-reference/config/next-config-js/output.md) — Next.js automatically traces which files are needed by each page to allow for easy deployment of your application. Learn how it works here.
- [pageExtensions](./api-reference/config/next-config-js/pageExtensions.md) — Extend the default page extensions used by Next.js when resolving pages in the Pages Router.
- [poweredByHeader](./api-reference/config/next-config-js/poweredByHeader.md) — Next.js will add the `x-powered-by` header by default. Learn to opt-out of it here.
- [productionBrowserSourceMaps](./api-reference/config/next-config-js/productionBrowserSourceMaps.md) — Enables browser source map generation during the production build.
- [proxyClientMaxBodySize](./api-reference/config/next-config-js/proxyClientMaxBodySize.md) — Configure the maximum request body size when using proxy.
- [reactCompiler](./api-reference/config/next-config-js/reactCompiler.md) — Enable the React Compiler to automatically optimize component rendering.
- [reactMaxHeadersLength](./api-reference/config/next-config-js/reactMaxHeadersLength.md) — The maximum length of the headers that are emitted by React and added to the response.
- [reactStrictMode](./api-reference/config/next-config-js/reactStrictMode.md) — The complete Next.js runtime is now Strict Mode-compliant, learn how to opt-in
- [redirects](./api-reference/config/next-config-js/redirects.md) — Add redirects to your Next.js app.
- [rewrites](./api-reference/config/next-config-js/rewrites.md) — Add rewrites to your Next.js app.
- [sassOptions](./api-reference/config/next-config-js/sassOptions.md) — Configure Sass options.
- [serverActions](./api-reference/config/next-config-js/serverActions.md) — Configure Server Actions behavior in your Next.js application.
- [serverComponentsHmrCache](./api-reference/config/next-config-js/serverComponentsHmrCache.md) — Configure whether fetch responses in Server Components are cached across HMR refresh requests.
- [serverExternalPackages](./api-reference/config/next-config-js/serverExternalPackages.md) — Opt-out specific dependencies from the Server Components bundling and use native Node.js `require`.
- [staleTimes](./api-reference/config/next-config-js/staleTimes.md) — Learn how to override the invalidation time of the Client Router Cache.
- [staticGeneration*](./api-reference/config/next-config-js/staticGeneration.md) — Learn how to configure static generation in your Next.js application.
- [taint](./api-reference/config/next-config-js/taint.md) — Enable tainting Objects and Values.
- [trailingSlash](./api-reference/config/next-config-js/trailingSlash.md) — Configure Next.js pages to resolve with or without a trailing slash.
- [transpilePackages](./api-reference/config/next-config-js/transpilePackages.md) — Automatically transpile and bundle dependencies from local packages (like monorepos) or from external dependencies (`node_modules`).
- [turbopack](./api-reference/config/next-config-js/turbopack.md) — Configure Next.js with Turbopack-specific options
- [turbopackFileSystemCache](./api-reference/config/next-config-js/turbopackFileSystemCache.md) — Learn how to enable FileSystem Caching for Turbopack builds
- [typedRoutes](./api-reference/config/next-config-js/typedRoutes.md) — Enable support for statically typed links.
- [typescript](./api-reference/config/next-config-js/typescript.md) — Configure how Next.js handles TypeScript errors during production builds and specify a custom tsconfig file.
- [urlImports](./api-reference/config/next-config-js/urlImports.md) — Configure Next.js to allow importing modules from external URLs.
- [useLightningcss](./api-reference/config/next-config-js/useLightningcss.md) — Enable experimental support for Lightning CSS.
- [viewTransition](./api-reference/config/next-config-js/viewTransition.md) — Enable ViewTransition API from React in App Router
- [webpack](./api-reference/config/next-config-js/webpack.md) — Learn how to customize the webpack config used by Next.js
- [webVitalsAttribution](./api-reference/config/next-config-js/webVitalsAttribution.md) — Learn how to use the webVitalsAttribution option to pinpoint the source of Web Vitals issues.
- [TypeScript](./api-reference/config/typescript.md) — Next.js provides a TypeScript-first development experience for building your React application.
- [ESLint](./api-reference/config/eslint.md) — Learn how to use and configure the ESLint plugin to catch common issues and problems in a Next.js application.

## api-reference/cli

- [CLI](./api-reference/cli.md) — API Reference for the Next.js Command Line Interface (CLI) tools.
- [create-next-app](./api-reference/cli/create-next-app.md) — Create Next.js apps using one command with the create-next-app CLI.
- [next CLI](./api-reference/cli/next.md) — Learn how to run and build your application with the Next.js CLI.

## api-reference/edge

- [Edge Runtime](./api-reference/edge.md) — API Reference for the Edge Runtime.

## api-reference/turbopack

- [Turbopack](./api-reference/turbopack.md) — Turbopack is an incremental bundler optimized for JavaScript and TypeScript, written in Rust, and built into Next.js.

