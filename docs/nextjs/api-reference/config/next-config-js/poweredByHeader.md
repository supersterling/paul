# poweredByHeader
@doc-version: 16.1.6
@last-updated: 2025-06-16


By default Next.js will add the `x-powered-by` header. To opt-out of it, open `next.config.js` and disable the `poweredByHeader` config:

```js filename="next.config.js"
module.exports = {
  poweredByHeader: false,
}
```
---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)