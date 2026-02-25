# generateEtags
@doc-version: 16.1.6
@last-updated: 2025-06-16


Next.js will generate [etags](https://en.wikipedia.org/wiki/HTTP_ETag) for every page by default. You may want to disable etag generation for HTML pages depending on your cache strategy.

Open `next.config.js` and disable the `generateEtags` option:

```js filename="next.config.js"
module.exports = {
  generateEtags: false,
}
```
---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)