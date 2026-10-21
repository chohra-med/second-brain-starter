# Tool pack: TanStack Query

<!-- rule-layer: tool -->
<!-- pack: tool-tanstack-query -->
<!-- applies: @tanstack/react-query >=5 -->

- **TQ-01** Make every query key an array that contains each variable the query function depends on. (source: TanStack Query documentation, Query keys, https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- **TQ-02** Keep query keys serializable and unique to the data they fetch. (source: TanStack Query documentation, Query keys, https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)
- **TQ-03** Set `staleTime` on purpose for each kind of data, because by default cached data is stale at once and refetches in the background. (source: TanStack Query documentation, Important defaults, https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
