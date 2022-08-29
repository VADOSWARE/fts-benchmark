import { build as _build } from "./sqlite.mjs";

export async function build(args) {
  return _build({
    ...args,
  });
}
