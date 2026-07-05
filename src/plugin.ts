/**
 * Buf plugin entry point.
 *
 * Implements the real Buf/protoc plugin protocol (binary CodeGeneratorRequest on
 * stdin, binary CodeGeneratorResponse on stdout) using @bufbuild/protoplugin,
 * reading the `google.api.http` extension directly from MethodOptions instead
 * of regex-parsing proto source.
 *
 * @module plugin
 */

import {
  createEcmaScriptPlugin,
  runNodeJs,
  type Schema,
} from "@bufbuild/protoplugin";
import { getOption, hasOption } from "@bufbuild/protobuf";
import type { DescExtension, DescFile } from "@bufbuild/protobuf";
import { generateRestAdapter } from "./generator";
import type { HttpMethod, ParsedMethod, ParsedService } from "./types";

/**
 * Field number of the `google.api.http` extension on MethodOptions
 * (see google/api/http.proto: `extend google.protobuf.MethodOptions { ... }`).
 */
const HTTP_EXTENSION_NUMBER = 72295728;

/**
 * Loose shape of a decoded `google.api.HttpRule` as emitted by
 * @bufbuild/protobuf. The `pattern` oneof is represented as a single
 * discriminated property `{ case, value }`.
 */
interface HttpRuleOneof {
  case: "get" | "put" | "post" | "delete" | "patch" | "custom" | undefined;
  value: unknown;
}

interface HttpRuleLike {
  selector?: string;
  pattern?: HttpRuleOneof;
  body?: string;
  responseBody?: string;
  additionalBindings?: HttpRuleLike[];
}

interface HttpMapping {
  method: HttpMethod;
  path: string;
  body?: string;
}

/**
 * Convert a decoded HttpRule into the method/path/body triple used by the
 * adapter. Returns null for rules without a usable pattern (e.g. custom
 * rules missing a path or unsupported oneof cases).
 */
function httpRuleToMapping(rule: HttpRuleLike): HttpMapping | null {
  const pattern = rule.pattern;
  if (!pattern || !pattern.case) return null;

  let method: HttpMethod | undefined;
  let path: string | undefined;

  switch (pattern.case) {
    case "get":
      method = "GET";
      path = pattern.value as string;
      break;
    case "put":
      method = "PUT";
      path = pattern.value as string;
      break;
    case "post":
      method = "POST";
      path = pattern.value as string;
      break;
    case "delete":
      method = "DELETE";
      path = pattern.value as string;
      break;
    case "patch":
      method = "PATCH";
      path = pattern.value as string;
      break;
    case "custom": {
      const custom = pattern.value as { kind?: string; path?: string };
      const kind = custom?.kind?.toUpperCase();
      if (
        kind &&
        (kind === "GET" ||
          kind === "POST" ||
          kind === "PUT" ||
          kind === "PATCH" ||
          kind === "DELETE")
      ) {
        method = kind;
        path = custom.path;
      }
      break;
    }
  }

  if (!method || !path) return null;

  return { method, path, body: rule.body || undefined };
}

/**
 * Find the `google.api.http` extension descriptor among all files in the
 * request (it lives in `google/api/http.proto`, which is pulled in as a
 * transitive dependency of `google/api/annotations.proto`).
 */
function findHttpExtension(
  allFiles: readonly DescFile[],
): DescExtension | undefined {
  for (const file of allFiles) {
    for (const ext of file.extensions) {
      if (
        ext.number === HTTP_EXTENSION_NUMBER &&
        ext.extendee.typeName === "google.protobuf.MethodOptions"
      ) {
        return ext;
      }
    }
  }
  return undefined;
}

/**
 * Generate the rest-adapter file from the Buf schema.
 */
function generate(schema: Schema): void {
  const httpExt = findHttpExtension(schema.allFiles);
  if (!httpExt) {
    // No google.api.http extension imported in the request — nothing to do.
    return;
  }

  const services: ParsedService[] = [];

  for (const file of schema.files) {
    const packageName = file.proto.package ?? "";

    for (const service of file.services) {
      const methods: ParsedMethod[] = [];

      for (const method of service.methods) {
        if (!hasOption(method, httpExt)) continue;

        const rule = getOption(method, httpExt) as unknown as HttpRuleLike;
        const primary = httpRuleToMapping(rule);
        if (!primary) continue;

        methods.push({
          name: method.name,
          inputType: method.input.typeName,
          outputType: method.output.typeName,
          httpMethod: primary.method,
          httpPath: primary.path,
          body: primary.body,
        });
      }

      if (methods.length > 0) {
        services.push({
          packageName,
          serviceName: service.name,
          fullName: service.typeName,
          methods,
        });
      }
    }
  }

  if (services.length === 0) return;

  const content = generateRestAdapter(services);
  const f = schema.generateFile("rest-adapter.ts");

  // Print the generated content line-by-line (GeneratedFile.print expects a
  // single line per call).
  for (const line of content.split("\n")) {
    f.print(line);
  }
}

/**
 * The Buf plugin. Run via `runNodeJs(restAdapterPlugin)`, which reads a
 * CodeGeneratorRequest from stdin and writes a CodeGeneratorResponse to stdout.
 */
export const restAdapterPlugin = createEcmaScriptPlugin({
  name: "connect-rest-adapter-es",
  version: "v0.1.0",
  generateTs(schema: Schema) {
    generate(schema);
  },
});

export { runNodeJs };
