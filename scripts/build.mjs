import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const result = await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['react'],
  write: false,
  metafile: true,
  legalComments: 'inline',
});
const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
if (imports.some(value => value.path !== 'react')) {
  throw new Error(`Unexpected Client runtime import: ${JSON.stringify(imports)}`);
}
const bundle = `// Built from src/client.tsx. React is supplied by Harness.\nwindow.__ModuleLoader__.load({\n  id: ${JSON.stringify(manifest.name)},\n  factory(require) {\n    const module = { exports: {} };\n    const exports = module.exports;\n${result.outputFiles[0].text}\n    return module.exports;\n  }\n});\n`;
await writeFile('client.js', bundle);
console.log(`Built client.js (${Buffer.byteLength(bundle)} bytes); external runtime: react only.`);
