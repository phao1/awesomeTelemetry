Batch transfers leave partial balance changes when a later transfer is rejected. Repair evaluate(balances, transfers) and the transfer helper. Transfers have source, target and amount; require existing accounts, a positive integer amount, and sufficient funds. Boolean amounts are invalid. Apply the entire batch atomically or return the original balances unchanged. Transfers to the same account are permitted when funded and have no net effect. Do not mutate either input, even on success.

Keep the existing public entry point. Use only the standard library.
