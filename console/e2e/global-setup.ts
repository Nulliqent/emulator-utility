import { down, up } from "./stack.ts";

export default async function globalSetup() {
  await up();
  return async () => down();
}
