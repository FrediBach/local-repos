import type { CommitActivityCache } from './commit-activity'
import type { Workspace } from '../types'
import { readProjectTags, type ProjectTags } from './project-tags'
import { SETTINGS_STORAGE_KEY } from './settings'
import { THEME_STORAGE_KEY } from '@/hooks/use-theme'
import type { ConfigBackup } from './config-backup'

const DATABASE = 'local-repos'
const STORE = 'preferences'
let connection: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Local storage is unavailable in this browser.'))
  if (!connection) {
    connection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
      }
      request.onsuccess = () => {
        const database = request.result
        database.onversionchange = () => { database.close(); connection = undefined }
        resolve(database)
      }
      request.onerror = () => { connection = undefined; reject(request.error ?? new Error('Could not open local cache.')) }
      request.onblocked = () => { connection = undefined; reject(new Error('Close other Local Repos tabs to update the local cache.')) }
    })
  }
  return connection
}

async function read<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error ?? new Error('Could not read local cache.'))
  })
}

async function write(key: string, value: unknown, remove = false): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    if (remove) transaction.objectStore(STORE).delete(key)
    else transaction.objectStore(STORE).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save local cache.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving local cache was interrupted.'))
  })
}

export const loadWorkspace = (): Promise<Workspace | undefined> => read<Workspace>('workspace')
export const saveWorkspace = (workspace: Workspace): Promise<void> => write('workspace', workspace)
export async function clearWorkspace(): Promise<void> {
  await write('workspace', undefined, true)
  await write('commit-activity', undefined, true)
}
export async function loadFavorites(): Promise<string[]> {
  const values = await read<unknown>('favorites')
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : []
}
export const saveFavorites = (ids: string[]): Promise<void> => write('favorites', [...new Set(ids)])
export const loadProjectTags = async (): Promise<ProjectTags> => readProjectTags(await read<unknown>('project-tags'))
export const saveProjectTags = (tags: ProjectTags): Promise<void> => write('project-tags', readProjectTags(tags))

/** Commit stars and tags together; restore localStorage if either storage area fails. */
export async function saveConfigPreferences(backup: ConfigBackup, favorites: string[], tags: ProjectTags): Promise<void> {
  const database = await openDatabase()
  const previous = new Map([SETTINGS_STORAGE_KEY, THEME_STORAGE_KEY].map(key => [key, localStorage.getItem(key)]))
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    const written: string[] = []
    let failure: unknown
    store.put([...new Set(favorites)], 'favorites')
    const request = store.put(readProjectTags(tags), 'project-tags')
    request.onsuccess = () => {
      try {
        for (const [key, value] of [[SETTINGS_STORAGE_KEY, JSON.stringify(backup.settings)], [THEME_STORAGE_KEY, backup.theme]]) {
          localStorage.setItem(key, value)
          written.push(key)
        }
      } catch (error) { failure = error; transaction.abort() }
    }
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => {
      let rollbackFailed = false
      for (const key of written) {
        try {
          const value = previous.get(key)
          if (value === null || value === undefined) localStorage.removeItem(key)
          else localStorage.setItem(key, value)
        } catch { rollbackFailed = true }
      }
      reject(new Error(rollbackFailed
        ? 'Import failed and some appearance settings could not be restored. Check browser storage permissions and reload.'
        : `Could not save the configuration. Your preferences were kept. ${failure instanceof Error ? failure.message : transaction.error?.message ?? 'Check browser storage permissions and try again.'}`))
    }
  })
}

export const loadCommitActivity = (): Promise<CommitActivityCache | undefined> => read<CommitActivityCache>('commit-activity')
export const saveCommitActivity = (cache: CommitActivityCache): Promise<void> => write('commit-activity', cache)
