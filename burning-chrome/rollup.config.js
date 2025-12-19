import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default [
  {
    input: 'report.js',
    output: {
      file: 'dist/report.js',
      format: 'es'
    },
    context: 'this',
    plugins: [
      nodeResolve(),
      commonjs()
    ]
  },
  {
    input: 'background.js',
    output: {
      file: 'dist/background.js',
      format: 'es'
    },
    context: 'this',
    plugins: [
      nodeResolve(),
      commonjs()
    ]
  }
];
