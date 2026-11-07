import json
from inventory import Inventory
from pathlib import Path
x=Inventory()
for action in json.loads(Path('shipment.json').read_text()):
    if action['op']=='ingest':
        x.ingest(action['rows'])
    elif action['op']=='correct':
        x.correct(action['id'],quantity=action.get('quantity'),warehouse=action.get('warehouse'),at=action.get('at'))
    else:
        print(action['day'],x.day(action['day']))
