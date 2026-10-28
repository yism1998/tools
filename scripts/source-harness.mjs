import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';

// Execute the actual TypeScript handlers with controlled browser dependencies.
export function sourceHarness(source, globals) {
  const parsed = ts.createSourceFile('handlers.ts', source
    .replaceAll('import.meta.env.BASE_URL', JSON.stringify('/tools/'))
    .replaceAll('import.meta.env.PROD', 'true')
    .replaceAll('import.meta.url', JSON.stringify('https://example.test/src/App.vue')), ts.ScriptTarget.ES2022, true);
  const isolated = ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,
    parsed.statements.filter(statement => !ts.isImportDeclaration(statement))));
  const script = ts.transpileModule(isolated, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = createContext({ exports: {}, console, URL, Uint8Array, Float32Array, Uint8ClampedArray, ...globals });
  runInContext(script, context);
  return { run: code => runInContext(code, context), context };
}
