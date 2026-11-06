from transfer import apply

def evaluate(balances, transfers):
    work = balances
    for transfer in transfers:
        if not apply(work, transfer):
            break
    return work
