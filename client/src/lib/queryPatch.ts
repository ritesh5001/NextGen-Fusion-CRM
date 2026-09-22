import type { QueryClient, QueryKey } from '@tanstack/react-query';

// A paginated list page as returned by our list endpoints ({ data, pagination, ... }).
type ListPage<T> = { data: T[] } & Record<string, unknown>;

export type Snapshots = [QueryKey, unknown][];

/**
 * Optimistically patch a single item (matched by `_id`) across every cached list
 * under `keyPrefix`, e.g. `['tasks']`. Returns the prior snapshots so the caller
 * can roll back in `onError`.
 */
export function patchListItem<T extends { _id: string }>(
  qc: QueryClient,
  keyPrefix: QueryKey,
  id: string,
  update: (item: T) => T
): Snapshots {
  const snapshots = qc.getQueriesData<ListPage<T>>({ queryKey: keyPrefix }) as Snapshots;
  qc.setQueriesData<ListPage<T>>({ queryKey: keyPrefix }, (old) => {
    if (!old?.data) return old;
    return { ...old, data: old.data.map((it) => (it._id === id ? update(it) : it)) };
  });
  return snapshots;
}

/** Optimistically remove an item (by `_id`) from every cached list under `keyPrefix`. */
export function removeListItem<T extends { _id: string }>(
  qc: QueryClient,
  keyPrefix: QueryKey,
  id: string
): Snapshots {
  const snapshots = qc.getQueriesData<ListPage<T>>({ queryKey: keyPrefix }) as Snapshots;
  qc.setQueriesData<ListPage<T>>({ queryKey: keyPrefix }, (old) => {
    if (!old?.data) return old;
    return { ...old, data: old.data.filter((it) => it._id !== id) };
  });
  return snapshots;
}

/** Restore snapshots captured by patch/remove (call from `onError`). */
export function restoreSnapshots(qc: QueryClient, snapshots?: Snapshots) {
  snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
}
