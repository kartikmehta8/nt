# Local MCP example

This example uses the repository-owned stdio fixture and never installs or
contacts a third-party server.

```bash
nt validate --file example/mcp/age.nt
nt mcp trust fixture --file example/mcp/age.nt
nt mcp list fixture --file example/mcp/age.nt
nt mcp inspect fixture echo --file example/mcp/age.nt
nt mcp doctor fixture --file example/mcp/age.nt
nt run mcp_example --file example/mcp/age.nt -m "Echo hello"
```

The run asks before calling `fixture.echo`; pass `--yes` to pre-approve that
invocation. Trust remains a separate prerequisite.
