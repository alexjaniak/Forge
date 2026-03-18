export function collectTemplateTypes(files: string[]): string[] {
  const types = new Set<string>();

  for (const file of files) {
    const match = file.match(/^(.+?)(?:\.example)?\.json$/);
    if (match?.[1]) {
      types.add(match[1]);
    }
  }

  return [...types].sort();
}

export function resolveTemplatePath(
  forgeRoot: string,
  type: string,
  existsSync: (path: string) => boolean
): string {
  const localPath = `${forgeRoot}/templates/${type}.json`;
  if (existsSync(localPath)) {
    return localPath;
  }

  return `${forgeRoot}/templates/${type}.example.json`;
}
