import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'report.js',
  output: {
    file: 'dist/report.js',
    format: 'es'
  },
  plugins: [
    nodeResolve()
  ]
};
