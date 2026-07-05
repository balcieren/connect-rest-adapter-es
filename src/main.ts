#!/usr/bin/env node
/**
 * Main entry point for connect-rest-adapter Buf plugin
 * Handles Buf plugin protocol (stdin/stdout) for CodeGeneratorRequest/Response
 * @module main
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { generateRestAdapter } from "./generator";
import { parseProtoFile } from "./parser";
import type { ParsedService } from "./types";
import { restAdapterPlugin, runNodeJs } from "./plugin";

/**
 * Process proto files from a directory (for local testing)
 */
async function processLocalProtoFiles(
  protoDir: string,
  outputDir: string,
): Promise<void> {
  const protoFiles: string[] = [];

  // Read all .proto files from directory
  const files = fs.readdirSync(protoDir, { recursive: true }) as string[];
  for (const file of files) {
    if (typeof file === "string" && file.endsWith(".proto")) {
      const fullPath = path.join(protoDir, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      protoFiles.push(content);
    }
  }

  if (protoFiles.length === 0) {
    console.error("No .proto files found");
    process.exit(1);
  }

  // Parse all proto files
  const allServices: ParsedService[] = [];
  for (const content of protoFiles) {
    const services = parseProtoFile(content);
    allServices.push(...services);
  }

  if (allServices.length === 0) {
    console.error("No services with google.api.http annotations found");
    process.exit(1);
  }

  // Generate output
  const restAdapterContent = generateRestAdapter(allServices);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write file
  fs.writeFileSync(path.join(outputDir, "rest-adapter.ts"), restAdapterContent);

  console.log(`Generated files in ${outputDir}:`);
  console.log("  - rest-adapter.ts");
  console.log(
    `\nFound ${allServices.length} service(s) with ${allServices.reduce((sum, s) => sum + s.methods.length, 0)} method(s)`,
  );
}

/**
 * Handle the Buf plugin protocol.
 *
 * Reads a binary `CodeGeneratorRequest` from stdin and writes a binary
 * `CodeGeneratorResponse` to stdout, mirroring what `buf generate` /
 * `protoc` expect. The actual work is done by the plugin created via
 * @bufbuild/protoplugin (see ./plugin.ts).
 */
function handleBufPlugin(): void {
  runNodeJs(restAdapterPlugin);
}

interface ParsedArgs {
  local: boolean;
  help: boolean;
  protoDir: string;
  outputDir: string;
}

/**
 * Parse CLI arguments into a structured form.
 * Flags: --local/-l, --out/-o <dir>, --help/-h
 * The first positional argument is used as the proto directory.
 */
function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    local: false,
    help: false,
    protoDir: "./proto",
    outputDir: "./generated",
  };

  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === "--local" || a === "-l") {
      result.local = true;
      i++;
    } else if (a === "--out" || a === "-o") {
      const value = args[i + 1];
      if (value && !value.startsWith("-")) {
        result.outputDir = value;
        i += 2;
      } else {
        i++; // ignore flag without value
      }
    } else if (a === "--help" || a === "-h") {
      result.help = true;
      i++;
    } else if (a.startsWith("-")) {
      // Unknown flag — ignore
      i++;
    } else {
      positional.push(a);
      i++;
    }
  }

  if (positional.length > 0) {
    result.protoDir = positional[0];
  }
  if (positional.length > 1) {
    result.outputDir = positional[1];
  }

  return result;
}

const HELP_TEXT = `
connect-rest-adapter - Generate REST adapter for Connect-RPC

Usage:
  # Local mode - process proto files from a directory
  connect-rest-adapter --local [proto-dir] --out [output-dir]

  # Buf plugin mode - pipe CodeGeneratorRequest (binary) via stdin
  buf generate

Options:
  --local, -l    Process local proto files
  --out, -o      Output directory (default: ./generated)
  --help, -h     Show this help message

Examples:
  connect-rest-adapter --local ./proto --out ./src/generated
  connect-rest-adapter --local ./proto -o ./src/generated
`;

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  // Check for local mode
  if (args.local) {
    await processLocalProtoFiles(args.protoDir, args.outputDir);
    return;
  }

  // Check if stdin has data (piped input)
  if (!process.stdin.isTTY) {
    handleBufPlugin();
    return;
  }

  // Show help
  console.log(HELP_TEXT);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
