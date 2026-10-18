// esbuild loads .css files with the `text` loader so they can be injected
// into a shadow root as a string.
declare module '*.css' {
  const content: string;
  export default content;
}
