# distDir
@doc-version: 16.1.6
@last-updated: 2025-06-16


You can specify a name to use for a custom build directory to use instead of `.next`.

Open `next.config.js` and add the `distDir` config:

```js filename="next.config.js"
module.exports = {
  distDir: 'build',
}
```

Now if you run `next build` Next.js will use `build` instead of the default `.next` folder.

> `distDir` **should not** leave your project directory. For example, `../build` is an **invalid** directory.
---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)