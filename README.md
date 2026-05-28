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

## Install in your app

Install from the npm registry — this is what most users want:

```sh
npm install --save-dev rxjs-leak-finder
# or pnpm add -D rxjs-leak-finder
# or yarn add -D rxjs-leak-finder
```

Then follow the [package README](./packages/rxjs-leak-detector/README.md#wire-it-up) to wire it into your `main.ts`.

### Contributing against a local checkout

Only needed if you're hacking on this monorepo and want to try changes in a real Angular app before publishing:

```sh
cd ../your-angular-app
npm install --save-dev file:../path/to/this/repo/packages/rxjs-leak-detector
```

## License

MIT © Florin Ciocirlan
