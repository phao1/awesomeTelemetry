class Cells:
    def __init__(self):
        self.data = {}
        self.accesses = 0
    def read(self, address):
        self.accesses += 1
        return self.data.get(address, 0)
    def write(self, address, value):
        self.accesses += 1
        if value:
            self.data[address] = value
        else:
            self.data.pop(address, None)
    def reset(self):
        self.accesses = 0
