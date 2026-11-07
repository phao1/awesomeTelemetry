from ramps import validate, apply, prefix

class Ledger:
    def __init__(self, n, cells):
        if type(n) is not int or n < 0:
            raise ValueError('size')
        self.n = n
        self.cells = cells
        self.names = {}
    def put(self, name, left, right, start, step):
        ramp = validate(self.n, left, right, start, step)
        if name in self.names:
            apply(self.cells, self.n, self.names[name], -1)
        self.names[name] = ramp
        apply(self.cells, self.n, ramp, 1)
    def remove(self, name):
        if name not in self.names:
            return False
        apply(self.cells, self.n, self.names.pop(name), -1)
        return True
    def sum(self, left, right):
        if type(left) is not int or type(right) is not int:
            raise ValueError('integer required')
        if left > right:
            raise ValueError('bounds')
        return prefix(self.cells, self.n, right) - prefix(self.cells, self.n, left)
    def batch(self, changes):
        staged = []
        for name, left, right, start, step in changes:
            staged.append((name, validate(self.n, left, right, start, step)))
        for name, ramp in staged:
            self.put(name, *ramp)
