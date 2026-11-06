def apply(balances, transfer):
    source, target, amount = transfer["source"], transfer["target"], transfer["amount"]
    if source not in balances or balances[source] < amount:
        return False
    balances[source] -= amount
    balances[target] = balances.get(target, 0) + amount
    return True
