import { ArrowRight, FolderOpen, Star, Terminal } from 'lucide-react'
import { Button } from './ui/button'

interface Props {
  filter: 'all' | 'favorites' | 'running'
  hasRefinements: boolean
  emptyWorkspace: boolean
  onReset: () => void
}

const states = {
  all: { icon: FolderOpen, title: 'Your next project starts here.', description: 'No repositories or package.json files were found in this directory.' },
  favorites: { icon: Star, title: 'Make room for your favorites.', description: 'Star a project to keep it within easy reach.' },
  running: { icon: Terminal, title: 'Nothing running. Room to begin.', description: 'Open a project and start its development server.' },
}

export function ProjectEmptyState({ filter, hasRefinements, emptyWorkspace, onReset }: Props) {
  const { icon: Icon, title, description } = states[filter]
  return <div className="empty-state">
    <Icon size={31} />
    <h2>{hasRefinements ? 'A little too quiet here.' : title}</h2>
    <p>{hasRefinements ? 'Try another search or clear your filters.' : description}</p>
    <Button variant="outline" onClick={onReset}>
      {emptyWorkspace ? 'Choose another directory' : 'Back to all projects'}<ArrowRight size={14} />
    </Button>
  </div>
}
