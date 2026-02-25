# Metadata Files API Reference
@doc-version: 16.1.6
@last-updated: 2025-10-17


This section of the docs covers **Metadata file conventions**. File-based metadata can be defined by adding special metadata files to route segments.

Each file convention can be defined using a static file (e.g. `opengraph-image.jpg`), or a dynamic variant that uses code to generate the file (e.g. `opengraph-image.js`).

Once a file is defined, Next.js will automatically serve the file (with hashes in production for caching) and update the relevant head elements with the correct metadata, such as the asset's URL, file type, and image size.

> **Good to know**:
>
> * Special Route Handlers like [`sitemap.ts`](/docs/app/api-reference/file-conventions/metadata/sitemap), [`opengraph-image.tsx`](/docs/app/api-reference/file-conventions/metadata/opengraph-image), and [`icon.tsx`](/docs/app/api-reference/file-conventions/metadata/app-icons), and other [metadata files](/docs/app/api-reference/file-conventions/metadata) are cached by default.
> * If using along with [`proxy.ts`](/docs/app/api-reference/file-conventions/proxy), [configure the matcher](/docs/app/api-reference/file-conventions/proxy#matcher) to exclude the metadata files.

- [favicon, icon, and apple-icon](/docs/app/api-reference/file-conventions/metadata/app-icons)
  - API Reference for the Favicon, Icon and Apple Icon file conventions.
- [manifest.json](/docs/app/api-reference/file-conventions/metadata/manifest)
  - API Reference for manifest.json file.
- [opengraph-image and twitter-image](/docs/app/api-reference/file-conventions/metadata/opengraph-image)
  - API Reference for the Open Graph Image and Twitter Image file conventions.
- [robots.txt](/docs/app/api-reference/file-conventions/metadata/robots)
  - API Reference for robots.txt file.
- [sitemap.xml](/docs/app/api-reference/file-conventions/metadata/sitemap)
  - API Reference for the sitemap.xml file.

---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)