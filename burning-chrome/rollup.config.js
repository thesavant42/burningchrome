import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const sharedConfig = {
  context: 'this',
  plugins: [nodeResolve(), commonjs()]
};

export default [
  { input: 'report.js', output: { file: 'dist/report.js', format: 'es' }, ...sharedConfig },
  { input: 'background.js', output: { file: 'dist/background.js', format: 'es' }, ...sharedConfig },
  { input: 'landing.js', output: { file: 'dist/landing.js', format: 'es' }, ...sharedConfig },
  { input: 'config.js', output: { file: 'dist/config.js', format: 'es' }, ...sharedConfig },
  { input: 'domains.js', output: { file: 'dist/domains.js', format: 'es' }, ...sharedConfig }
];
