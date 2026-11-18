import { registry } from "./sdk-registry.gen";
// Loads a client only on demand, like the Invoker would.
export async function load(serviceId: string) { return registry[serviceId]?.(); }
(window as any).load = load;
console.log(Object.keys(registry).length);
