import { HelperError } from '../scanner'

export class McpFailure extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message) }
}
export function failure(error: unknown): McpFailure {
  if (error instanceof McpFailure) return error
  if (error instanceof HelperError) {
    if (error.message.startsWith('PROCESS_GENERATION_CHANGED:')) return new McpFailure('PROCESS_GENERATION_CHANGED', 'Read the current process generation before stopping it.')
    if (error.message.startsWith('SCOPE_CONFLICT:')) return new McpFailure('SCOPE_CONFLICT', 'Workspace or Git context changed while resources were busy. Rescan when idle.')
    const code = ({ 400: 'INVALID_ARGUMENT', 403: 'PATH_CHANGED', 404: 'PATH_CHANGED', 409: 'PROJECT_BUSY', 503: 'DEPENDENCY_UNAVAILABLE', 504: 'TIMEOUT' } as Record<number, string>)[error.status] ?? 'OPERATION_FAILED'
    return new McpFailure(code, 'The local operation could not complete. Check the project and helper state.', [409, 503, 504].includes(error.status))
  }
  return new McpFailure('OPERATION_FAILED', 'The local operation could not complete.')
}
