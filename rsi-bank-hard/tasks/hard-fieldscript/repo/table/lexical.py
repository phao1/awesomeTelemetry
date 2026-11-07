def tokenize(text):
    return [line.split('|') for line in text.splitlines() if line and not line.startswith('#')]
