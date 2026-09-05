import re

with open('index.html', encoding='utf-8') as f:
    html = f.read()
with open('app.js', encoding='utf-8') as f:
    js = f.read()

js_ids = set(re.findall(r"getElementById\('([^']+)'\)", js))
html_ids = set(re.findall(r'id="([^"]+)"', html))

missing = js_ids - html_ids
print("Missing IDs:", missing)
