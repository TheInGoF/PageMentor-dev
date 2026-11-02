// Dateien, die Bun als Pfad einbindet (with { type: "file" }); in der Exe eingebettet
declare module "*.otf" {
  const path: string;
  export default path;
}
declare module "*.wasm" {
  const path: string;
  export default path;
}
