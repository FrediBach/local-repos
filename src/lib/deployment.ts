export const installationUrl = 'https://github.com/FrediBach/local-repos#run-locally'

export function isVercelHosted(hostname = window.location.hostname): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  // A downloaded Vercel build can still be previewed locally with the helper.
  if (host === 'localhost' || host.endsWith('.localhost') || /^127(?:\.\d{1,3}){3}$/.test(host) || host === '[::1]' || host === '::1') return false
  // The build flag covers custom domains; the hostname also works when Vercel's
  // system environment variables have been disabled in the project settings.
  return import.meta.env.VITE_VERCEL_HOSTED === '1' || host.endsWith('.vercel.app')
}
