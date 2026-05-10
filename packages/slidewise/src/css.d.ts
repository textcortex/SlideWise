// Allow side-effect imports of plain CSS files from TypeScript.
// The library bundles its CSS into dist/slidewise.css; consumers import
// "@textcortex/slidewise/style.css" separately (see package.json exports).
declare module "*.css";
