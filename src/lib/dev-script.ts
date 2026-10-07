/** The same startup choice is used for action availability and the local helper. */
export function selectDevScript(project: { scripts: Record<string, string> }): { name: string; command: string } | undefined {
  for (const name of ['dev', 'start', 'serve']) {
    const command = project.scripts[name]
    if (typeof command === 'string' && command.trim()) return { name, command }
  }
  return undefined
}
