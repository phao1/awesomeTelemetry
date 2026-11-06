Tenant reservations affect each other and duplicate cancellations create quota. Repair Evaluate(limits, operations) and the reservation helper. Limits map tenants to nonnegative capacities. A reserve Op uses Tenant, ID and Quantity; accept only positive quantities within the tenant remaining quota, with ids unique within that tenant. A cancel restores only a live reservation for that tenant. Unknown tenants and operation kinds do nothing. Return each tenant remaining quota without modifying inputs.

Keep the existing public entry point. Use only the standard library.
