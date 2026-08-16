/** Vite `?url` imports: fingerprinted asset URLs, resolved at build time. */
declare module "*.css?url" {
  const url: string;
  export default url;
}

declare module "*.js?url" {
  const url: string;
  export default url;
}

/** Injected by the Vite `define` in vite.config.ts. */
declare const __BUILD_COMMIT_SHA__: string;
declare const __DEV__: boolean;
declare const __IS_PREVIEW_BUILD__: boolean;
