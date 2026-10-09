import { Code2, Ellipsis, FolderGit2, FolderOpen, GitBranch, HardDrive, Monitor, PackageSearch, Play, ShieldCheck, Square, Star, Stethoscope, Tag, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from './ui/dropdown-menu'
import { useSettings } from '@/hooks/use-settings'
import { desktopAppName } from '@/lib/desktop-apps'
import { projectCommands } from '@/lib/project-commands'
import type { OpenProjectRequest, PreviewMode, RepoProject } from '@/types'

interface Props {
  project: RepoProject
  tagsReady: boolean
  favorite: boolean
  busy: string
  onOpen: (project: RepoProject) => void
  onEditTags: (project: RepoProject) => void
  onToggleFavorite: (id: string) => void
  onAction: (project: RepoProject, action: string, body?: unknown) => void
}

const scanIcons = { audit: ShieldCheck, outdated: PackageSearch, unused: Trash2, 'react-doctor': Stethoscope, storage: HardDrive }
const previewSources: { source: PreviewMode; label: string }[] = [
  { source: 'auto', label: 'Automatic' },
  { source: 'local', label: 'Local project' },
  { source: 'website', label: 'Project URL' },
]

export function ProjectActionMenu({ project, tagsReady, favorite, busy, onOpen, onEditTags, onToggleFavorite, onAction }: Props) {
  const { settings } = useSettings()
  const commands = projectCommands(project, settings, favorite)
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><button className="project-menu" aria-label={`Actions for ${project.name}`}><Ellipsis size={17} /></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem onSelect={() => onOpen(project)}><FolderGit2 size={14} />Project details</DropdownMenuItem>
      <DropdownMenuItem disabled={!tagsReady} onSelect={() => onEditTags(project)}><Tag size={14} />Edit tags</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onToggleFavorite(project.id)}><Star size={14} />{favorite ? 'Remove favorite' : 'Add to favorites'}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!!busy} onSelect={() => onAction(project, 'open', { app: settings.editor } satisfies OpenProjectRequest)}><Code2 size={14} />Open in {desktopAppName(settings.editor)}</DropdownMenuItem>
      <DropdownMenuItem disabled={!!busy} onSelect={() => onAction(project, 'open', { app: settings.gitClient } satisfies OpenProjectRequest)}><GitBranch size={14} />Open in {desktopAppName(settings.gitClient)}</DropdownMenuItem>
      <DropdownMenuItem disabled={!!busy} onSelect={() => onAction(project, 'open', { app: 'folder' })}><FolderOpen size={14} />Show in folder</DropdownMenuItem>
      <DropdownMenuSeparator />
      {commands.map(command => {
        if (!(command.id in scanIcons) || command.intent.kind !== 'action') return null
        const Icon = scanIcons[command.id as keyof typeof scanIcons]
        const { name, body } = command.intent
        return <DropdownMenuItem key={command.id} disabled={!!busy} onSelect={() => onAction(project, name, body)}><Icon size={14} />{command.title}</DropdownMenuItem>
      })}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!!busy}><Monitor size={14} />Capture preview</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {previewSources.map(({ source, label }) => <DropdownMenuItem key={source} disabled={!!busy} onSelect={() => onAction(project, 'screenshot', { source })}>{label}</DropdownMenuItem>)}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {commands.filter(command => command.id === 'start' || command.id === 'stop').map(command => <DropdownMenuItem key={command.id} disabled={!!busy} onSelect={() => onAction(project, command.id)}>{command.id === 'start' ? <Play size={14} /> : <Square size={14} />}{command.title}</DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}
