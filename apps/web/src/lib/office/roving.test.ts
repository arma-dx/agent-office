import { describe, expect, it } from 'vitest';
import { nextItem, type RovingItem } from './roving.ts';

const ITEMS: RovingItem[] = [
  { id: 'unit:KOR', kind: 'unit' },
  { id: 'agent:KOR-1', kind: 'agent' },
  { id: 'agent:KOR-2', kind: 'agent' },
  { id: 'unit:OFY', kind: 'unit' },
  { id: 'unit:HAF', kind: 'unit' },
  { id: 'agent:HAF-1', kind: 'agent' },
];

describe('nextItem', () => {
  it('steps through every item with Down and Up and stops at the ends', () => {
    expect(nextItem(ITEMS, 'unit:KOR', 'ArrowDown')).toBe('agent:KOR-1');
    expect(nextItem(ITEMS, 'agent:KOR-2', 'ArrowDown')).toBe('unit:OFY');
    expect(nextItem(ITEMS, 'unit:OFY', 'ArrowUp')).toBe('agent:KOR-2');
    expect(nextItem(ITEMS, 'unit:KOR', 'ArrowUp')).toBeNull();
    expect(nextItem(ITEMS, 'agent:HAF-1', 'ArrowDown')).toBeNull();
  });

  it('jumps between units with Right and Left', () => {
    expect(nextItem(ITEMS, 'unit:KOR', 'ArrowRight')).toBe('unit:OFY');
    expect(nextItem(ITEMS, 'agent:KOR-1', 'ArrowRight')).toBe('unit:OFY');
    expect(nextItem(ITEMS, 'agent:KOR-2', 'ArrowLeft')).toBe('unit:KOR');
    expect(nextItem(ITEMS, 'unit:HAF', 'ArrowLeft')).toBe('unit:OFY');
    expect(nextItem(ITEMS, 'agent:HAF-1', 'ArrowRight')).toBeNull();
    expect(nextItem(ITEMS, 'unit:KOR', 'ArrowLeft')).toBeNull();
  });

  it('goes to the first and last item with Home and End', () => {
    expect(nextItem(ITEMS, 'unit:OFY', 'Home')).toBe('unit:KOR');
    expect(nextItem(ITEMS, 'unit:OFY', 'End')).toBe('agent:HAF-1');
    expect(nextItem(ITEMS, 'unit:KOR', 'Home')).toBeNull();
  });

  it('ignores other keys and unknown items', () => {
    expect(nextItem(ITEMS, 'unit:KOR', 'Enter')).toBeNull();
    expect(nextItem(ITEMS, 'unit:NONE', 'ArrowDown')).toBeNull();
    expect(nextItem([], 'unit:KOR', 'End')).toBeNull();
  });
});
