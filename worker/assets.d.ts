/** Vite `?url` imports: fingerprinted asset URLs, resolved at build time. */
declare module "*.css?url" {
  const url: string;
  export default url;
}

declare module "*.js?url" {
  const url: string;
  export default url;
}

/** Vite `?inline` imports: the file itself as a data URI, encoded at build
 *  time. A card is served as an image and may not fetch, so its fonts have to
 *  travel inside it. */
declare module "*.woff2?inline" {
  const dataUri: string;
  export default dataUri;
}

/** Injected by the Vite `define` in vite.config.ts. */
declare const __BUILD_COMMIT_SHA__: string;
declare const __DEV__: boolean;
declare const __IS_PREVIEW_BUILD__: boolean;
