import type { Workspace } from '../types'
import { readProjectTags, type ProjectTags } from './project-tags'

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
export const clearWorkspace = (): Promise<void> => write('workspace', undefined, true)
export async function loadFavorites(): Promise<string[]> {
  const values = await read<unknown>('favorites')
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : []
}
export const saveFavorites = (ids: string[]): Promise<void> => write('favorites', [...new Set(ids)])
export const loadProjectTags = async (): Promise<ProjectTags> => readProjectTags(await read<unknown>('project-tags'))
export const saveProjectTags = (tags: ProjectTags): Promise<void> => write('project-tags', readProjectTags(tags))
