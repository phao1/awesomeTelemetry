def validate(n, left, right, start, step):
    if any(type(x) is not int for x in (left, right, start, step)):
        raise ValueError('integer required')
    if not 0 <= left <= right <= n:
        raise ValueError('bounds')
    return (left, right, start, step)

def apply(cells, n, ramp, sign):
    left, right, start, step = ramp
    for index in range(left, right):
        cells.write(index, cells.read(index) + sign * (start + (index - left) * step))

def prefix(cells, n, stop):
    return sum(cells.read(index) for index in range(max(0, min(n, stop))))
