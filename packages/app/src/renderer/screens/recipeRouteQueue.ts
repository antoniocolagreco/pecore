type Entry = { state: number; priority: number };

export class PriorityQueue {
  private readonly entries: Entry[] = [];

  push(state: number, priority: number): void {
    const entries: Entry[] = this.entries;
    let index: number = entries.length;
    entries.push({ state, priority });
    while (index > 0) {
      const parent: number = (index - 1) >> 1;
      if (entries[parent]!.priority <= priority) break;
      entries[index] = entries[parent]!;
      index = parent;
    }
    entries[index] = { state, priority };
  }

  pop(): Entry | undefined {
    const entries: Entry[] = this.entries;
    const first: Entry | undefined = entries[0];
    const last: Entry | undefined = entries.pop();
    if (!last || entries.length === 0) return first;
    let index: number = 0;
    while (index * 2 + 1 < entries.length) {
      const left: number = index * 2 + 1;
      const right: number = left + 1;
      const child: number = right < entries.length && entries[right]!.priority < entries[left]!.priority ? right : left;
      if (entries[child]!.priority >= last.priority) break;
      entries[index] = entries[child]!;
      index = child;
    }
    entries[index] = last;
    return first;
  }
}
