export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4)
  return `${(bytes / 1024 ** index).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][index]}`
}
