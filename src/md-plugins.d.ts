// Type shims for markdown-it plugins that don't ship their own declarations.
// They're applied via `md.use(...)`, so `any` is sufficient here.
declare module "markdown-it-task-lists" {
  const plugin: any;
  export default plugin;
}
declare module "markdown-it-footnote" {
  const plugin: any;
  export default plugin;
}
declare module "markdown-it-emoji" {
  export const full: any;
  export const light: any;
  export const bare: any;
}
declare module "markdown-it-deflist" {
  const plugin: any;
  export default plugin;
}
declare module "markdown-it-container" {
  const plugin: any;
  export default plugin;
}
