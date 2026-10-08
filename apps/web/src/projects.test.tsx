import { PROJECT_COLORS, PROJECT_ICONS } from '@agent-office/shared';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectTile } from './components/projects/project-tile.tsx';
import { COLOR_NAME, ICON_NAME, PROJECT_FILL, PROJECT_ICON } from './lib/projects/labels.ts';

describe('project tile', () => {
  it('ProjectTile: a fill and an icon for every colour and icon of the contract, hidden from screen readers', () => {
    // A colour or an icon the contract gains must get its fill, its pictogram and its name here.
    expect(PROJECT_FILL).toEqual(
      Object.fromEntries(PROJECT_COLORS.map((color) => [color, `bg-project-${color}`])),
    );
    expect(Object.keys(COLOR_NAME)).toEqual([...PROJECT_COLORS]);
    expect(Object.keys(PROJECT_ICON)).toEqual([...PROJECT_ICONS]);
    expect(Object.keys(ICON_NAME)).toEqual([...PROJECT_ICONS]);
    // Twelve different pictograms: two icons never look the same.
    expect(new Set(Object.values(PROJECT_ICON)).size).toBe(PROJECT_ICONS.length);

    for (const color of PROJECT_COLORS) {
      const { container, unmount } = render(<ProjectTile color={color} icon="folder" />);
      const tile = container.querySelector('span');
      expect(tile).toHaveClass(`bg-project-${color}`, 'text-surface', 'size-6');
      expect(tile).toHaveAttribute('aria-hidden', 'true');
      unmount();
    }
    for (const icon of PROJECT_ICONS) {
      const { container, unmount } = render(<ProjectTile color="gray" icon={icon} size="md" />);
      const tile = container.querySelector('span');
      expect(tile).toHaveClass('size-8');
      const glyph = container.querySelector('svg');
      expect(glyph).toHaveClass('size-4');
      expect(glyph?.getAttribute('class')).toContain(
        `lucide-${(PROJECT_ICON[icon].displayName ?? '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`,
      );
      unmount();
    }
  });
});
