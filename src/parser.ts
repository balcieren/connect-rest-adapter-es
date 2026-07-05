/**
 * Proto file parser for extracting google.api.http annotations
 * Uses regex-based parsing (no external dependencies)
 * @module parser
 */

import type { HttpMethod, ParsedMethod, ParsedService } from "./types";

/**
 * Parse a proto file content and extract services with HTTP annotations
 * @param content - Raw proto file content
 * @returns Array of parsed services with their methods
 */
export function parseProtoFile(content: string): ParsedService[] {
  const services: ParsedService[] = [];

  // Strip comments first so brace matching and regexes are not fooled
  // by comment text containing braces or special tokens.
  const clean = stripComments(content);

  // Extract package name
  const packageName = extractPackageName(clean);

  // Extract all services
  const serviceMatches = extractServices(clean);

  for (const serviceMatch of serviceMatches) {
    const serviceName = serviceMatch.name;
    const methods = extractMethods(serviceMatch.body);

    if (methods.length > 0) {
      services.push({
        packageName,
        serviceName,
        fullName: packageName ? `${packageName}.${serviceName}` : serviceName,
        methods,
      });
    }
  }

  return services;
}

/**
 * Parse multiple proto files and combine results
 * @param files - Array of proto file contents
 * @returns Combined array of parsed services
 */
export function parseProtoFiles(files: string[]): ParsedService[] {
  const allServices: ParsedService[] = [];

  for (const content of files) {
    const services = parseProtoFile(content);
    allServices.push(...services);
  }

  return allServices;
}

/**
 * Strip line and block comments from proto content while preserving
 * string literals (so comment-like sequences inside paths/options survive).
 */
function stripComments(content: string): string {
  let result = "";
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    const next = content[i + 1];

    // String literal — copy verbatim until the matching quote
    if (c === '"' || c === "'") {
      const quote = c;
      result += c;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === "\\" && i + 1 < content.length) {
          result += content[i] + content[i + 1];
          i += 2;
        } else {
          result += content[i];
          i++;
        }
      }
      if (i < content.length) {
        result += content[i];
        i++;
      }
      continue;
    }

    // Line comment — skip to end of line
    if (c === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      continue;
    }

    // Block comment — skip to closing */
    if (c === "/" && next === "*") {
      i += 2;
      while (
        i < content.length &&
        !(content[i] === "*" && content[i + 1] === "/")
      ) {
        i++;
      }
      i += 2;
      continue;
    }

    result += c;
    i++;
  }

  return result;
}

/**
 * Extract package name from proto file
 */
function extractPackageName(content: string): string {
  const match = content.match(/^\s*package\s+([\w.]+)\s*;/m);
  return match ? match[1] : "";
}

interface ServiceMatch {
  name: string;
  body: string;
}

/**
 * Extract all service definitions from proto content
 */
function extractServices(content: string): ServiceMatch[] {
  const services: ServiceMatch[] = [];
  const serviceRegex = /service\s+(\w+)\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = serviceRegex.exec(content)) !== null) {
    const serviceName = match[1];
    const startIndex = match.index + match[0].length;
    const body = extractBracedContent(content, startIndex);

    if (body) {
      services.push({ name: serviceName, body });
    }
  }

  return services;
}

/**
 * Extract content between matching braces.
 * Assumes comments have already been stripped; string literals may contain
 * braces but they are expected to be balanced (e.g. `{user_id}`), so plain
 * depth counting remains correct for typical http path patterns.
 */
function extractBracedContent(content: string, startIndex: number): string {
  let depth = 1;
  let i = startIndex;

  while (i < content.length && depth > 0) {
    const c = content[i];
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    }
    i++;
  }

  return content.slice(startIndex, i - 1);
}

/**
 * Find the index of the brace that closes the opening brace at `openIndex`.
 * String-aware: braces inside string literals are ignored.
 */
function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 1;
  let i = openIndex + 1;
  while (i < content.length) {
    const c = content[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === "\\" && i + 1 < content.length) i += 2;
        else i++;
      }
      i++; // skip closing quote
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Extract RPC methods with HTTP annotations from service body.
 * Supports an optional `stream` keyword for both input and output types.
 */
function extractMethods(serviceBody: string): ParsedMethod[] {
  const methods: ParsedMethod[] = [];

  // Allow optional `stream` keyword before input/output message types.
  const rpcStartRegex =
    /rpc\s+(\w+)\s*\(\s*(?:stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([\w.]+)\s*\)\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = rpcStartRegex.exec(serviceBody)) !== null) {
    const methodName = match[1];
    const inputType = match[2];
    const outputType = match[3];
    const startIndex = match.index + match[0].length;

    // Extract the RPC body using brace matching
    const optionsBlock = extractBracedContent(serviceBody, startIndex);

    const httpAnnotation = parseHttpAnnotation(optionsBlock);

    if (httpAnnotation) {
      methods.push({
        name: methodName,
        inputType,
        outputType,
        httpMethod: httpAnnotation.method,
        httpPath: httpAnnotation.path,
        body: httpAnnotation.body,
      });
    }
  }

  return methods;
}

interface HttpAnnotation {
  method: HttpMethod;
  path: string;
  body?: string;
}

/**
 * Locate the `option (google.api.http) = { ... };` block within an RPC options
 * block and return its inner content (the text between the outer braces).
 * Uses string-aware brace matching so nested `additional_bindings { }` blocks
 * and braces inside path strings (e.g. `{user_id}`) are handled correctly.
 */
function extractHttpOptionContent(optionsBlock: string): string | null {
  const markerIdx = optionsBlock.indexOf("google.api.http");
  if (markerIdx === -1) return null;

  const eqIdx = optionsBlock.indexOf("=", markerIdx);
  if (eqIdx === -1) return null;

  const braceIdx = optionsBlock.indexOf("{", eqIdx);
  if (braceIdx === -1) return null;

  const closeIdx = findMatchingBrace(optionsBlock, braceIdx);
  if (closeIdx === -1) return null;

  return optionsBlock.slice(braceIdx + 1, closeIdx);
}

/**
 * Remove `additional_bindings { ... }` nested blocks so only the primary
 * google.api.http binding is considered when picking the HTTP method/path.
 */
function stripAdditionalBindings(content: string): string {
  const result: string[] = [];
  let lastEnd = 0;
  const re = /additional_bindings\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const braceIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingBrace(content, braceIdx);
    if (closeIdx === -1) break;
    result.push(content.slice(lastEnd, m.index));
    lastEnd = closeIdx + 1;
    re.lastIndex = closeIdx + 1;
  }
  result.push(content.slice(lastEnd));
  return result.join("");
}

/**
 * Parse the primary google.api.http annotation from an options block.
 * additional_bindings are ignored (only the primary binding is used).
 */
function parseHttpAnnotation(optionsBlock: string): HttpAnnotation | null {
  if (!optionsBlock.includes("google.api.http")) {
    return null;
  }

  const content = extractHttpOptionContent(optionsBlock);
  if (content === null) return null;

  const primary = stripAdditionalBindings(content);

  const httpMethods: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  for (const method of httpMethods) {
    const methodLower = method.toLowerCase();
    // Match patterns like: get: "/v1/users/{user_id}" or get: '/v1/users/{user_id}'
    const pathRegex = new RegExp(
      `${methodLower}\\s*:\\s*["']([^"']+)["']`,
      "i",
    );
    const pathMatch = primary.match(pathRegex);

    if (pathMatch) {
      const path = pathMatch[1];

      // Extract optional body field
      const bodyRegex = /body\s*:\s*["']([^"']+)["']/;
      const bodyMatch = primary.match(bodyRegex);

      return {
        method,
        path,
        body: bodyMatch ? bodyMatch[1] : undefined,
      };
    }
  }

  return null;
}

/**
 * Get Connect path for a service method
 * @example "/users.v1.UserService/GetUser"
 */
export function getConnectPath(
  service: ParsedService,
  method: ParsedMethod,
): string {
  return `/${service.fullName}/${method.name}`;
}
