def evaluate(start, end, bookings):
    cursor = start
    gaps = []
    for left, right in sorted(bookings):
        if left > cursor:
            gaps.append([cursor, left])
        cursor = right
    if cursor < end:
        gaps.append([cursor, end])
    return gaps
