# vue-router-hooks
>Recursively run hooks before resolving routes

Provides a simplified interface for running custom hooks (i.e. `beforeRouteResolve`) on components before resolving routes when using [vue-router](https://router.vuejs.org/).

Useful for data pre-fetching and sharing state between the server + client. See the Vue SSR guide on [Data Pre-Fetching and State](https://ssr.vuejs.org/guide/data.html) for more information.

## Installation

```bash
npm i vue-router-hooks
```

Assumes you have Node 8+ and are building the client with [babel](https://babeljs.io/) with the latest shipped Proposals (i.e. `async`/`await`).
> If you see an error about `regeneratorRuntime` not being defined, it's most likely because you don't have `babel` configured correctly for `async`/`await`

If you aren't using ES6/7 yet, you should start!

## Usage
> Error handling omitted for the sake of brevity

### First, in your server and client entry points:
```js
import routerHooks from 'vue-router-hooks';

/**
 * Assumes you already have matchedComponents, store, and routes defined.
 * Typically used in router.onReady and/or router.beforeResolve depending on
 * use-case (client vs. server).
 * @see https://ssr.vuejs.org/guide/data.html or "Full working example" section
 * below for more help if these are foreign concepts
 */
const { beforeRouteResolve, beforeRouteResolveServer } = routerHooks({
  matchedComponents,
  store,
  route,
  hooks: ['beforeResolve', 'beforeRouteResolveServer'], // or 'beforeRouteResolveClient' in the client entry point
});

// run all beforeRouteResolve hooks recursively, then all beforeRouteResolveServer hooks recursively
await Promise.all(beforeRouteResolve.promiseFunctions.map(cb => cb()); // run all promise functions in parallel
await Promise.all(beforeRouteResolveServer.promiseFunctions.map(cb => cb()); // run all promise functions in parallel

// DONE! resolve the route (i.e. resolve(app) or next())
// See "Full working example" below for more details
```

### Then, in your components:

```js
export default {
  name 'my-component',
  async beforeRouteResolve({ store, route }) {
    console.log('I am run before the route resolves on either the server or client')
  }
  async beforeRouteResolveServer({ store, route }) {
    console.log('I am run before the route resolves on either the server')
  }
  async beforeRouteResolveClient({ store, route }) {
    console.log('I am run before the route resolves on either the client')
  }
}
```

## Full working example

### entry.client.js
```js
/**
 * The main entry point for the client.
 */
import 'babel-polyfill';
import createApp from './create-app';
import routerHooks from 'vue-router-hooks';

const { app, router, store } = createApp();

// This is how state data is passed between the server and client. Populated by context.state set in entry.server.js
if (window.__INITIAL_STATE__) {
  store.replaceState(window.__INITIAL_STATE__);
}

// onReady is fired a single time, when the initial route navigation is completed. Triggered automatically by vue-router
router.onReady(() => {
  /**
   * Fetch all async data when routing client-side, before resolving the route.
   * Attach after initial route is ready to ensure the hook is only called for subsequent (client-side) routes
   * and we don't double-fetch for the initial page route.
   *
   * @see https://ssr.vuejs.org/en/data.html
   */
  router.beforeResolve(async (to, from, next) => {
    const matched = router.getMatchedComponents(to);
    const prevMatched = router.getMatchedComponents(from);

    // we only care about non-previously-rendered components,
    // so we compare them until the two matched lists differ
    let diffed = false;
    const matchedComponents = matched.filter((c, i) => {
      return diffed || (diffed = (prevMatched[i] !== c));
    });

    if (!matchedComponents.length) {
      return next();
    }

    // Allow for route components to asynchronously interact with the store before resolving the route.
    const hooks = routerHooks({
      matchedComponents,
      store,
      route: to,
      hooks: ['beforeRouteResolve', 'beforeRouteResolveClient'],
    });

    try {
      // run all beforeRouteResolve hooks recursively, then all beforeRouteResolveClient hooks recursively
      await Promise.all(hooks.beforeRouteResolve.promiseFunctions.map(cb => cb()));
      await Promise.all(hooks.beforeRouteResolveClient.promiseFunctions.map(cb => cb()));
    } catch (err) {
      // be sure to bubble up any errors thrown by promises
      return next(err);
    }

    next();
  });

  app.$mount('#app-wrapper');
});
```

### entry.server.js
```js
/**
 * The main entry point for the server.
 */
import 'babel-polyfill';
import routerHooks from 'vue-router-hooks';
import createApp from './app';

export default (context) => new Promise((resolve, reject) => {
  const { app, router, store } = createApp();

  // set the router's location internally and trigger lifecycle hooks, including onReady
  router.push(context.url);

  // onReady is fired a single time, when the initial route navigation is completed. triggered by router.push above.
  router.onReady(async () => {
    const matchedComponents = router.getMatchedComponents();

    const err = new Error(`Invalid route: ${context.url}`);
    err.code = 404;
    if (!matchedComponents.length) {
      return reject(err);
    }

    // Allow for route components to asynchronously interact with the store before resolving the route.
    const hooks = routerHooks({
      matchedComponents,
      store,
      route: router.currentRoute,
      hooks: ['beforeRouteResolve', 'beforeRouteResolveServer'],
    });

    try {
      // run all beforeRouteResolve hooks recursively, then all beforeRouteResolveServer hooks recursively
      await Promise.all(hooks.beforeRouteResolve.promiseFunctions.map(cb => cb()));
      await Promise.all(hooks.beforeRouteResolveServer.promiseFunctions.map(cb => cb()));
    } catch (err) {
      // be sure to bubble up any errors thrown by promises
      return reject(err);
    }

    /**
     * Store now contains the state needed to render the app server-side.
     *
     * In order to share this same state client-side (for the purpose of hydration), it is attached to the context.
     * This will tell the bundle renderer to serialize & inject the state into index.html as `window.__INITIAL_STATE__`.
     *
     * This allows the client entry point (entry.client.js) to populate it's store with the state of the
     * application set up server-side, without having to run the same async operations again to populate the state.
     */
    context.state = store.state;
    resolve(app);
  }, reject);
});
```
