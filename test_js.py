import urllib.request
import re

html = open('index.html', encoding='utf-8').read()
js = open('app.js', encoding='utf-8').read()

print('Evaluating JS syntax using quick regex checks...')

# Let's check for basic syntax issues
def check_braces(text):
    count = 0
    for char in text:
        if char == '{': count += 1
        elif char == '}': count -= 1
    return count

print('Brace balance:', check_braces(js))

