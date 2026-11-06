export function evaluate(path) {
  return "/" + path.split("/").filter(Boolean).join("/");
}
