# nt

The `nt` command-line interface for NT agent ecosystems. A thin layer over
[`@age.nt/engine`](../engine): it parses arguments, loads a project (an entry `.nt`
file whose imports are followed, or a directory), and inspects or runs it.

```bash
nt validate --file example/age.nt
nt graph    --file example/age.nt
nt run  age --file example/age.nt -m "bought the first iPhone at 22"
nt chat age --file example/age.nt
```

Commands: `validate`, `list`, `graph`, `up`, `run`, `chat`. See the
[root README](../../README.md) for flags and the language reference.
