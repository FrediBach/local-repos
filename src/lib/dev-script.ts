/** The same startup choice is used for action availability and the local helper. */
export function selectDevScript(project: { scripts: Record<string, string> }): { name: string; command: string } | undefined {
  for (const name of ['dev', 'start', 'serve']) {
    const command = project.scripts[name]
    if (typeof command === 'string' && command.trim()) return { name, command }
  }
  return undefined
}

/** Only inspect a simple command; never interpret or execute shell expressions. */
export function simpleCommand(script: string): { tokens: string[]; assignments: Record<string, string> } | undefined {
  if (/[|&;<>()`#\r\n]/.test(script)) return undefined
  const tokens: string[] = []
  let token = ''
  let started = false
  let quote = ''
  let escaped = false
  for (const character of script.trim()) {
    if (escaped) { token += character; escaped = false; started = true; continue }
    if (character === '\\' && quote !== "'") { escaped = true; continue }
    if (quote) {
      if (character === quote) quote = ''
      else token += character
    } else if (character === '"' || character === "'") { quote = character; started = true }
    else if (/\s/.test(character)) {
      if (started) tokens.push(token)
      token = ''
      started = false
    } else { token += character; started = true }
  }
  if (quote || escaped) return undefined
  if (started) tokens.push(token)
  const assignments: Record<string, string> = {}
  while (tokens.length) {
    const assignment = /^([A-Za-z_][A-Za-z_\d]*)=(.*)$/.exec(tokens[0])
    if (assignment) {
      assignments[assignment[1]] = assignment[2]
      tokens.shift()
    } else if (['cross-env', 'env'].includes(tokens[0].split('/').pop() ?? '')) tokens.shift()
    else break
  }
  // npx wrappers are common in package scripts. Flags to npx itself are left
  // alone because their argument forwarding rules vary by version.
  if (tokens[0] === 'npx' && tokens[1] && !tokens[1].startsWith('-')) tokens.shift()
  if (!tokens.length || tokens.includes('--')) return undefined
  return { tokens, assignments }
}
