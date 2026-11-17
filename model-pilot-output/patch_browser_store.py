from pathlib import Path
p = Path('model-pilot-output/review_browser_acceptance.py')
t = p.read_text(encoding='utf-8')
t = t.replace("""class Body:
    def __init__(self, data): self.data = data
    def read(self): return self.data
    def close(self): return None
""", """class Body:
    def __init__(self, data): self.data = data
    def read(self): return self.data
    def iter_chunks(self, chunk_size=262144):
        for index in range(0, len(self.data), chunk_size):
            yield self.data[index:index + chunk_size]
    def close(self): return None
""")
t = t.replace("""    def get_object(self, Bucket=None, Key=None, Range=None):
        data = self.objects[Key]
        if Range:
            start, end = Range.replace('bytes=', '').split('-')
            data = data[int(start):int(end) + 1 if end else None]
        return {'Body': Body(data), 'ContentLength': len(data)}
""", """    def get_object(self, Bucket=None, Key=None, Range=None):
        data = self.objects[Key]
        response = {'Body': Body(data), 'ContentLength': len(data)}
        if Range:
            start, end = Range.replace('bytes=', '').split('-')
            first = int(start) if start else 0
            last = int(end) if end else len(data) - 1
            data = data[first:last + 1]
            response = {'Body': Body(data), 'ContentLength': len(data),
                        'ContentRange': f'bytes {first}-{last}/{len(self.objects[Key])}'}
        return response
""")
p.write_text(t, encoding='utf-8')
print('patched')
