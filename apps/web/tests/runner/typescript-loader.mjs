/**
 * ESM loader used by the frontend test runner.
 *
 * The project already compiles with the TypeScript compiler and declares it as a
 * dev dependency. Transpiling tests and sources with that compiler keeps the test
 * runtime independent of a bundler service process, while preserving ESM, JSX, TS
 * emulation and ordinary Node diagnostics. It deliberately does not type-check:
 * `tsc --noEmit` remains the build/type gate, exactly as before.
 *
 * The loader also mirrors `tsx`'s implicit extension resolution for the repository's
 * extensionless relative imports (`../../api`, `../../packages/foo/bar`).
 */
import {existsSync, statSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, extname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const require = createRequire(fileURLToPath(new URL('../../package.json', import.meta.url)));
const ts = require('typescript');

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const SOURCE_MAPS = process.env.TS_TEST_SOURCE_MAPS === '1';

const isFile = path => {
  try { return statSync(path).isFile(); } catch { return false; }
};
const isDirectory = path => {
  try { return statSync(path).isDirectory(); } catch { return false; }
};

function candidatePath(basePath, specifier) {
  if (isFile(basePath)) return basePath;
  for (const extension of EXTENSIONS) {
    const path = `${basePath}${extension}`;
    if (isFile(path)) return path;
  }
  // TypeScript source sometimes names an emitted `.js` file explicitly.
  if (extname(specifier) === '.js') {
    const withoutExtension = basePath.slice(0, -3);
    for (const extension of ['.ts', '.tsx']) {
      const path = `${withoutExtension}${extension}`;
      if (isFile(path)) return path;
    }
  }
  if (isDirectory(basePath)) {
    for (const extension of EXTENSIONS) {
      const path = `${basePath}/index${extension}`;
      if (isFile(path)) return path;
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const base = new URL(specifier, context.parentURL);
    const found = candidatePath(fileURLToPath(base), specifier);
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }
  return nextResolve(specifier, context);
}

function transform(fileName, source) {
  const output = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      sourceMap: SOURCE_MAPS,
      inlineSources: SOURCE_MAPS,
    },
  });
  const errors = (output.diagnostics ?? []).filter(diagnostic =>
    diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    const host = {
      getCanonicalFileName: name => name,
      getCurrentDirectory: () => dirname(fileName),
      getNewLine: () => '\n',
    };
    throw new Error(`TypeScript could not transform ${fileName}:\n${
      ts.formatDiagnosticsWithColorAndContext(errors, host)}`);
  }
  if (!SOURCE_MAPS || !output.sourceMapText) return output.outputText;
  const map = Buffer.from(output.sourceMapText, 'utf8').toString('base64');
  return `${output.outputText}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${map}`;
}

export async function load(url, context, nextLoad) {
  if (/\.css(?:[?#].*)?$/.test(url)) return {format: 'module', source: '', shortCircuit: true};
  // Mirror the bundler for JSON: Vite imports a JSON file as a default export, while
  // Node 22 demands `with { type: 'json' }` on every JSON import. Serving it as a
  // module here keeps the app source unchanged and the runtime consistent with Vite.
  if (/\.json(?:[?#].*)?$/.test(url)) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    return {format: 'module', source: `export default ${source.trim()};`, shortCircuit: true};
  }
  if (/\.(ts|tsx|mts|cts)(?:[?#].*)?$/.test(url)) {
    const fileName = fileURLToPath(url);
    const source = await readFile(fileName, 'utf8');
    return {format: 'module', source: transform(fileName, source), shortCircuit: true};
  }
  return nextLoad(url, context);
}
