import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { trackInputKind } from './input-kind.ts';

describe('input kind', () => {
  it('marks the root with the last kind of input until it is stopped', () => {
    const root = document.createElement('html');
    const stop = trackInputKind(root);
    expect(root.dataset['input']).toBeUndefined();
    fireEvent.pointerDown(document.body);
    expect(root.dataset['input']).toBe('pointer');
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(root.dataset['input']).toBe('keyboard');
    stop();
    fireEvent.pointerDown(document.body);
    expect(root.dataset['input']).toBe('keyboard');
  });

  it('sees a press that a component keeps to itself', () => {
    const root = document.createElement('html');
    const stop = trackInputKind(root);
    const button = document.createElement('button');
    button.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    document.body.append(button);
    fireEvent.pointerDown(button);
    expect(root.dataset['input']).toBe('pointer');
    stop();
    button.remove();
  });
});
