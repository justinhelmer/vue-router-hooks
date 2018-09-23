/**
 * Allow for route components to asynchronously interact with the store before resolving the route.
 * One example of this would be dispatching to an external API service (node.js HTTP), retrieving data,
 * then committing the result to the store for the component's template to access and render server-side (SSR).
 */
module.exports = ({ matchedComponents, store, route, hooks = [] }) => {
  const hookCache = {};
  hooks.forEach((hook) => hookCache[hook] = { promiseFunctions: [], keys: [] });

  const recursive = (component, key) => {
    hooks.forEach((hook) => {
      const cache = hookCache[hook];
      if (cache.keys.indexOf(key) !== -1) return;
      cache.keys.push(key);

      if (typeof component[hook] === 'function') {
        // dont execute the promise yet - let caller control the flow
        cache.promiseFunctions.push(() => component[hook]({ store, route }));
      }

      if (component.components) {
        Object.keys(component.components).forEach(key => recursive(component.components[key], key));
      }
    });
  };

  matchedComponents.map((component) => recursive(component, component.name));
  return hookCache;
};

