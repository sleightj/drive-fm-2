import { RoadGenerator, ForkInfo, BRANCH_HORIZON } from './generator';
import { Path } from './path';

/**
 * Keeps the road generated ahead of the player and trimmed behind, and decides forks:
 * the game and the Node checks drive this the same way.
 */
export class RoadStream {
  horizon: number;
  keepBehind: number;
  constructor(public gen: RoadGenerator, horizon = 3400, keepBehind = 1800) {
    this.horizon = horizon;
    this.keepBehind = keepBehind;
  }

  /** The fork that ends `p`, if any. */
  forkOf(p: Path): ForkInfo | undefined {
    return this.gen.forks.find((f) => f.trunk === p);
  }

  /**
   * Generate ahead of (path, s): along the path, and through forks into both branches up to
   * BRANCH_HORIZON, and beyond that along committed branches.
   */
  ensure(path: Path, s: number, budgetMs = Infinity) {
    const want = s + this.horizon;
    this.deadline = performance.now() + budgetMs;
    this.extendChain(path, want);
  }
  /** Generation stops planning new pieces after this time (it carries on at the next call). */
  private deadline = Infinity;

  private extendChain(p: Path, untilS: number) {
    // untilS is measured in this path's arc length
    if (p.forkS === null) {
      this.gen.extend(p, untilS, this.deadline);
    }
    if (p.forkS !== null) {
      this.gen.extendProfile(p, true);
      const rest = untilS - p.forkS;
      const f = this.forkOf(p)!;
      for (const b of [f.left, f.right]) {
        const committed = f.committed === 0 ? true : (f.committed === 1 ? b === f.left : b === f.right);
        const lim = committed && f.committed !== 0 ? rest : Math.min(rest, BRANCH_HORIZON);
        // both branches always reach BRANCH_HORIZON (so the untaken one never ends in view)
        const target = Math.max(lim, BRANCH_HORIZON);
        if (b.gen && !b.gen.stopped) this.extendChain(b, f.committed === 0 ? Math.min(target, BRANCH_HORIZON) : target);
      }
    }
  }

  /** Called when the player's current path changes to `p` (they drove onto a branch). */
  enter(p: Path) {
    const f = this.gen.forks.find((ff) => ff.left === p || ff.right === p);
    if (f) this.gen.commitFork(f, p === f.left ? 1 : -1);
  }

  /** Discard road far behind the player on (path, s); returns paths removed entirely. */
  trim(path: Path, s: number): Path[] {
    const removed: Path[] = [];
    const net = this.gen.net;
    if (s - this.keepBehind - path.base > 400) net.trim(path, s - this.keepBehind);
    let child = path;
    let behind = s; // distance from the player back to the start of `child`
    let a = child.parent;
    while (a) {
      const f = this.forkOf(a);
      const sib = f ? (child === f.left ? f.right : f.left) : null;
      if (behind > this.keepBehind) {
        // everything before this fork is out of reach: drop the trunk and the other branch
        if (sib) this.removeTree(sib, removed);
        const up = a.parent;
        this.removeTree(a, removed, child);
        child.parent = null;
        if (f) this.gen.forks.splice(this.gen.forks.indexOf(f), 1);
        // anything further up was already handled on earlier calls; detach and stop
        if (up) this.removeChain(up, removed);
        break;
      }
      const keepFrom = (a.forkS ?? a.length) - (this.keepBehind - behind);
      if (keepFrom - a.base > 400) net.trim(a, keepFrom);
      behind += a.forkS ?? a.length;
      child = a;
      a = a.parent;
    }
    return removed;
  }

  private removeChain(p: Path, out: Path[]) {
    let q: Path | null = p;
    while (q) {
      const up: Path | null = q.parent;
      this.removeTree(q, out);
      const f = this.forkOf(q);
      if (f) this.gen.forks.splice(this.gen.forks.indexOf(f), 1);
      q = up;
    }
  }

  private removeTree(p: Path, out: Path[], keep?: Path) {
    if (p === keep) return;
    for (const c of p.children) if (c !== keep) this.removeTree(c, out, keep);
    if (this.gen.net.paths.includes(p)) {
      this.gen.net.remove(p);
      out.push(p);
    }
  }
}
