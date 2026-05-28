# rxjs-leak-finder — monorepo

This repo is the monorepo for [`rxjs-leak-finder`](./packages/rxjs-leak-detector), a dev-mode tool that finds leaked RxJS subscriptions in Angular apps. One line in `main.ts`, a floating widget, a local dashboard. No Chrome extension.

👉 **[Read the package README](./packages/rxjs-leak-detector/README.md)** for install + usage.
👉 **[How it works](./packages/rxjs-leak-detector/HOW_IT_WORKS.md)** for the architecture.

## Layout

| Package | Published? | What it does |
|---|---|---|
| [`packages/rxjs-leak-detector`](./packages/rxjs-leak-detector) | **yes — `rxjs-leak-finder` on npm** | Runtime (the `Observable` patch + widget), CLI (`rxjs-leak-finder dashboard`), and the bundled dashboard SPA. |
| `packages/analyzer-core` | no (devDep) | Stack-trace classification, source-map resolution, leak-kind heuristics. Bundled into the dashboard. |
| `packages/panel-ui` | no (devDep) | Lit components for the dashboard UI. Bundled into the dashboard. |
| `packages/runtime` | no | Experiments around runtime tagging strategies. |
| `packages/tagger` | no | Reference build of the in-page widget. |
| `packages/extension` | no | Earlier Chrome-extension prototype (superseded by the floating widget). |

## Develop

```sh
pnpm install
pnpm build      # builds all packages
pnpm test       # runs all unit tests
```

To test against a real Angular app, install the local package via `file:`:

```sh
cd ../your-angular-app
npm install --save-dev file:../path/to/this/repo/packages/rxjs-leak-detector
```

## License

MIT © Florin Ciocirlan
