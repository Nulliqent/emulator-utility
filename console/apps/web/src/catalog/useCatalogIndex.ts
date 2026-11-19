import { useQuery } from "@tanstack/react-query";
import { fetchMeta } from "../api.ts";
import { fetchCatalogIndex } from "./fetch.ts";

/** The Catalog index for the Gateway's current fingerprint. Shared by every feature that lists Services. */
export function useCatalogIndex() {
  const meta = useQuery({ queryKey: ["meta"], queryFn: fetchMeta });
  const fingerprint = meta.data?.catalog.fingerprint ?? null;
  const index = useQuery({
    queryKey: ["catalog", fingerprint],
    queryFn: () => fetchCatalogIndex(fingerprint!),
    enabled: fingerprint !== null,
    staleTime: Infinity,
  });
  return { index, fingerprint, metaError: meta.isError ? (meta.error as Error) : null, noCatalog: meta.isSuccess && fingerprint === null };
}
