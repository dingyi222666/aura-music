import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "bun:test";

const root = path.resolve(import.meta.dir, "..");
const dirs = readdirSync(path.join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const packages = dirs.map((dir) => ({
  dir: path.join(root, "packages", dir),
  manifest: JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf8")),
}));

test("workspace exports exist and dependency graph is acyclic", () => {
  const graph = new Map(packages.map(({ manifest }) => [manifest.name, Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@aura-music/"))]));
  const visit = (name: string, stack: string[]) => {
    expect(stack).not.toContain(name);
    expect(graph.has(name)).toBe(true);
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...stack, name]);
  };
  for (const pkg of packages) {
    visit(pkg.manifest.name, []);
    for (const target of Object.values(pkg.manifest.exports)) {
      expect(existsSync(path.join(pkg.dir, target as string))).toBe(true);
    }
  }
});

test("library source imports stay inside declared package boundaries", () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const pkg of packages) {
    for (const file of walk(path.join(pkg.dir, "src")).filter((file) => /\.[cm]?[jt]sx?$/.test(file))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
        const source = match[1];
        expect(source).not.toContain("apps/");
        expect(source.startsWith("@/")).toBe(false);
        if (!source.startsWith("@aura-music/")) continue;
        const name = source.split("/").slice(0, 2).join("/");
        expect(Object.keys(pkg.manifest.dependencies ?? {})).toContain(name);
      }
    }
  }
});
