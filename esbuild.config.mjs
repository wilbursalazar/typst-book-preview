import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  banner: {
    js: "/* THIS FILE IS GENERATED FROM main.ts. */"
  },
  bundle: true,
  entryPoints: ["main.ts"],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules
  ],
  format: "cjs",
  logLevel: "info",
  outfile: "main.js",
  platform: "node",
  sourcemap: production ? false : "inline",
  target: "es2022",
  treeShaking: true
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
