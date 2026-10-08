import { ArrowRight, Box, Package, Wrench } from 'lucide-react'
import { dependencyKindLabel } from '@/lib/packages'
import { formatOutdatedScore } from '@/lib/outdated'
import type { OutdatedFinding } from '@/types'
import './dependency-updates.css'

const categories = [
  { name: 'Production dependencies', kinds: ['dependencies', 'optionalDependencies'], Icon: Package },
  { name: 'Development dependencies', kinds: ['devDependencies'], Icon: Wrench },
  { name: 'Peer dependencies', kinds: ['peerDependencies'], Icon: Box },
  { name: 'Other dependencies', kinds: [undefined], Icon: Box },
]
function changeLabel(finding: OutdatedFinding) {
  if (finding.change === 'major') return `${finding.majorGap} major ${finding.majorGap === 1 ? 'version' : 'versions'} behind`
  return `${finding.change === 'prerelease' ? 'Prerelease' : finding.change === 'minor' ? 'Minor' : 'Patch'} update`
}

// Local adaptation of https://www.shadcn.io/blocks/changelog-dependency-updates.
export function DependencyUpdates({ findings }: { findings: OutdatedFinding[] }) {
  return <div className="dependency-updates">
    <div className="dependency-update-summary" aria-label="Update types">{(['major', 'minor', 'patch', 'prerelease'] as const).map(change => {
      const count = findings.filter(finding => finding.change === change).length
      return count ? <span key={change} className={`dependency-change dependency-change-${change}`}>{count} {change}</span> : null
    })}</div>
    {categories.map(({ name, kinds, Icon }) => {
      const items = findings.filter(finding => kinds.some(kind => kind === finding.kind))
      if (!items.length) return null
      return <section key={name} className="dependency-update-group" aria-label={name}>
        <div className="dependency-group-heading"><h4><Icon size={15} />{name}</h4><span>{items.length}</span></div>
        <ul className="dependency-update-list">{items.map(finding => <li key={`${finding.kind ?? ''}:${finding.name}`}>
          <div className="dependency-update-main"><div className="dependency-package-name"><Package size={15} aria-hidden="true" /><strong>{finding.name}</strong></div>
            <span className={`dependency-change dependency-change-${finding.change}`}>{finding.change}</span>
          </div>
          <div className="dependency-version-diff"><code className="dependency-version-from">{finding.current}</code><ArrowRight size={14} aria-label="to" /><code className="dependency-version-to">{finding.latest}</code><span>latest</span></div>
          <div className="dependency-update-detail"><span>{changeLabel(finding)}</span>{finding.kind && <span>{dependencyKindLabel(finding.kind)}</span>}<span className="outdated-points">+{formatOutdatedScore(finding.score)} {finding.score === 1 ? 'point' : 'points'}</span></div>
          {finding.wanted && finding.wanted !== finding.latest && <p className="dependency-wanted">Within declared range: <code>{finding.wanted}</code></p>}
        </li>)}</ul>
      </section>
    })}
  </div>
}
