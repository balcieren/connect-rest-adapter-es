# connect-rest-adapter-es

A Buf plugin that generates a REST adapter for Connect-RPC clients, rewriting Connect URLs to REST paths using `google.api.http` annotations.

## Problem

When using Connect-RPC with `google.api.http` annotations, the client uses standard Connect paths:

```
POST /users.v1.UserService/GetUser  ❌
```

But you want REST paths:

```
GET /v1/users/{user_id}  ✅
```

## Installation

```bash
npm install connect-rest-adapter --save-dev
```

## Quick Start

### 1. Define HTTP annotations in your proto

```protobuf
syntax = "proto3";
package users.v1;

import "google/api/annotations.proto";

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse) {
    option (google.api.http) = {
      get: "/v1/users/{user_id}"
    };
  };

  rpc CreateUser(CreateUserRequest) returns (CreateUserResponse) {
    option (google.api.http) = {
      post: "/v1/users"
      body: "*"
    };
  };
}
```

### 2. Generate

**Option A: Local Mode**

```bash
npx connect-rest-adapter --local ./proto --out ./src/generated
```

**Option B: With Buf**

```yaml
# buf.gen.yaml
version: v2
plugins:
  - local: protoc-gen-connect-rest-adapter-es
    out: gen
    opt: target=ts
inputs:
  - directory: proto
```

```bash
buf generate
```

> The `target=ts` option makes the plugin emit TypeScript (`.ts`). Without it,
> the plugin defaults to JavaScript + declaration files (`.js` + `.d.ts`).

### 3. Use in your client

```typescript
import { createConnectTransport } from "@connectrpc/connect-web";
import { createClient } from "@connectrpc/connect";
import { restAdapter } from "./generated/rest-adapter";
import { UserService } from "./generated/user_pb";

// Default: camelCase query params (protobuf JSON format)
const transport = createConnectTransport({
  baseUrl: "http://localhost:3000",
  fetch: restAdapter(),
});
// → GET /v1/users?pageSize=10&pageToken=abc

// Or: snake_case query params (proto field names)
const transport2 = createConnectTransport({
  baseUrl: "http://localhost:3000",
  fetch: restAdapter({ queryParamFormat: "snake_case" }),
});
// → GET /v1/users?page_size=10&page_token=abc

const client = createClient(UserService, transport);

// Requests now use REST paths:
// GET /v1/users/123 instead of POST /users.v1.UserService/GetUser
const response = await client.getUser({ userId: "123" });
```

## Generated Files

| File              | Purpose                                           |
| ----------------- | ------------------------------------------------- |
| `rest-adapter.ts` | **Custom fetch that rewrites URLs to REST paths** |

## Server Compatibility

`restAdapter()` requires a server that supports REST ↔ Connect transcoding:

| Server                                                                                                                                | Support                                           |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [Vanguard](https://github.com/connectrpc/vanguard-go)                                                                                 | ✅ Reads `google.api.http` from proto descriptors |
| [grpc-gateway](https://github.com/grpc-ecosystem/grpc-gateway)                                                                        | ✅ Generates REST reverse proxy                   |
| [Envoy gRPC-JSON transcoder](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/grpc_json_transcoder_filter) | ✅ Filter-based transcoding                       |

## CLI Options

```bash
# Local mode - parse proto files from a directory
connect-rest-adapter --local [proto-dir] --out [output-dir]

# Buf plugin mode - invoked by `buf generate` (binary CodeGeneratorRequest on stdin)
buf generate
```

| Option          | Description                              | Default       |
| ---------------- | ---------------------------------------- | ------------- |
| `--local`, `-l` | Enable local mode (parse proto sources)  | -             |
| `--out`, `-o`   | Output directory (local mode only)       | `./generated` |
| `--help`, `-h`   | Show help message                        | -             |

> Without `--local`, the binary reads a protobuf `CodeGeneratorRequest` from
> stdin (the standard protoc/buf plugin protocol). Piping raw `.proto` text
> directly is **not** supported.

## Features

- ✅ Real Buf plugin protocol via `@bufbuild/protoplugin`
- ✅ Reads `google.api.http` from method descriptors (not regex parsing)
- ✅ Supports GET, POST, PUT, PATCH, DELETE (incl. `custom` pattern)
- ✅ Handles `stream` RPC methods
- ✅ Comment-safe parsing (braces in comments don't break extraction)
- ✅ Handles `additional_bindings` (uses the primary binding)
- ✅ Handles nested path variables (e.g. `/v1/users/{user_id}/posts/{post_id}`)
- ✅ Configurable query param format (`camelCase` or `snake_case`)
- ✅ Full TypeScript support
- ✅ Works with Buf (`buf generate`) and standalone (`--local`)

## License

MIT
