# typescript
@doc-version: 16.1.6
@last-updated: 2025-12-09


Configure TypeScript behavior with the `typescript` option in `next.config.js`:

```js filename="next.config.js"
module.exports = {
  typescript: {
    ignoreBuildErrors: false,
    tsconfigPath: 'tsconfig.json',
  },
}
```

## Options

| Option              | Type      | Default           | Description                                                      |
| ------------------- | --------- | ----------------- | ---------------------------------------------------------------- |
| `ignoreBuildErrors` | `boolean` | `false`           | Allow production builds to complete even with TypeScript errors. |
| `tsconfigPath`      | `string`  | `'tsconfig.json'` | Path to a custom `tsconfig.json` file.                           |

## `ignoreBuildErrors`

Next.js fails your **production build** (`next build`) when TypeScript errors are present in your project.

If you'd like Next.js to dangerously produce production code even when your application has errors, you can disable the built-in type checking step.

If disabled, be sure you are running type checks as part of your build or deploy process, otherwise this can be very dangerous.

```js filename="next.config.js"
module.exports = {
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
}
```

## `tsconfigPath`

Use a different TypeScript configuration file for builds or tooling:

```js filename="next.config.js"
module.exports = {
  typescript: {
    tsconfigPath: 'tsconfig.build.json',
  },
}
```

See the [TypeScript configuration](/docs/app/api-reference/config/typescript#custom-tsconfig-path) page for more details.
---

For an overview of all available documentation, see [/docs/llms.txt](/docs/llms.txt)