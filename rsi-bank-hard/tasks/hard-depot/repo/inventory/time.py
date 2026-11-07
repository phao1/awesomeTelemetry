from datetime import datetime,timezone

def canonical(value):
    if not isinstance(value,str):
        raise ValueError('timestamp')
    try:
        date=datetime.fromisoformat(value.replace('Z','+00:00'))
    except (ValueError,TypeError):
        raise ValueError('timestamp') from None
    if date.tzinfo is None:
        raise ValueError('timezone')
    return date.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')

def day_range(start,stop):
    if len(start)!=10 or len(stop)!=10 or start>stop:
        raise ValueError('days')
    datetime.strptime(start,'%Y-%m-%d')
    datetime.strptime(stop,'%Y-%m-%d')
    return start,stop
