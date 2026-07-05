# v0.2.0 — Release Notes

### Breaking Changes

- **Buf plugin protocol rewritten** — The old `handleBufPlugin` accepted raw proto text or JSON via stdin and was incompatible with `buf generate`. The plugin now uses `@bufbuild/protoplugin` to read the real binary `CodeGeneratorRequest`/`CodeGeneratorResponse` protobuf protocol. Piping raw `.proto` source directly is **no longer supported** — use `buf generate` instead.
- **Runtime dependencies added** — `@bufbuild/protoplugin` and `@bufbuild/protobuf` are now required at runtime. This drops the "zero runtime dependencies" claim (the generated `rest-adapter.ts` itself still has zero dependencies).

### Bug Fixes

- **Parser: `stream` keyword support** — RPC methods with `stream ChatRequest` or `returns (stream ChatResponse)` are now correctly parsed instead of being silently skipped.
- **Parser: braces in comments** — Line comments (`// {`) and block comments (`/* } */`) no longer break brace matching during service/method body extraction.
- **Parser: `additional_bindings`** — Only the primary `google.api.http` binding is used; nested `additional_bindings { }` blocks no longer confuse the extraction of method/path/body.
- **CLI: `--local` argument parsing** — Fixed fragile `args.find()` that could pick `--out`'s value as the proto directory. Now uses a proper `parseArgs()` function with flag-aware positional separation.
- **Generator: missing `Accept` header** — The generated `restAdapter()` now sets `Accept: application/json` so servers return JSON instead of protobuf.
- **Generator: Request body from `Request` object** — When the transport passes a `Request` as `input` without `init.body`, the body is now read via `request.clone().text()`.
- **`test/tsconfig.json` target mismatch** — Changed from `ES2020` to `ES2024` to match the source tsconfig.
- **Dockerfile: dev dependencies in production image** — The production stage now runs `npm ci --omit=dev`, keeping only runtime packages.

### Features

- **Real Buf plugin protocol** — The plugin now correctly handles the binary protobuf wire protocol expected by `buf generate` and `protoc`, reading `google.api.http` directly from `MethodOptions` descriptors rather than regex-parsing source files.
- **`--help`/`-h` flag** — Added CLI help with usage instructions.
- **CLI: `npx connect-rest-adapter --local ./proto --out ./src/generated`**
- **Buf:**
  ```yaml
  # buf.gen.yaml
  plugins:
    - local: protoc-gen-connect-rest-adapter-es
      out: gen
      opt: target=ts
  ```

### Full Changelog

```
9b9ffa9 fix: implement real Buf plugin protocol, harden parser and CLI
498f380 docs: update README for real Buf plugin protocol
```
