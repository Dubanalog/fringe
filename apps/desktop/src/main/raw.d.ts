/** Text files imported as strings (Vite's ?raw), e.g. the AI guides in docs/ai. */
declare module '*.md?raw' {
  const text: string;
  export default text;
}
