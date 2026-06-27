# Code Highlighting

Fenced code blocks are highlighted by language (highlight.js). Back to the
[index](README.md).

Code blocks show a header with the **language** (or a **filename** if you supply
one) and a **copy** button. Add a filename with `title="…"` or `lang:filename`:


```rust title="src/main.rs"
fn main() {
    println!("named via title=");
}
```

```python:scripts/build.py
print("named via lang:filename")
```

Each code block has its own header: **123** toggles line numbers, **📋** copies
the source, **💾** saves it to a file. With line numbers on, click a number to
highlight that line.

## Rust

```rust
fn main() {
    let greeting = "Hello, Markdown!";
    for word in greeting.split_whitespace() {
        println!("{word}");
    }
}
```

## TypeScript

```typescript
interface Doc {
  path: string;
  content: string;
}

const render = (docs: Doc[]): number =>
  docs.reduce((n, d) => n + d.content.length, 0);
```

## Python

```python
from dataclasses import dataclass

@dataclass
class Point:
    x: float
    y: float

    def dist(self) -> float:
        return (self.x ** 2 + self.y ** 2) ** 0.5
```

## Bash

```bash
#!/usr/bin/env bash
set -euo pipefail
for f in *.md; do
  echo "Rendering $f"
done
```

## JSON

```json
{
  "name": "markdown-gui",
  "features": ["render", "mermaid", "math"],
  "fast": true
}
```

## SQL

```sql
SELECT title, COUNT(*) AS views
FROM documents
GROUP BY title
ORDER BY views DESC
LIMIT 10;
```

## Plain (no language)

```
No language tag — rendered as monospace, not highlighted.
```
