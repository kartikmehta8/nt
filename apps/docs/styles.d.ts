/**
 * @file TypeScript module declaration for stylesheet side-effect imports.
 *
 * Allows Next.js layout modules to import the global CSS bundle without adding
 * runtime exports or weakening type checking elsewhere.
 */

declare module "*.css";
