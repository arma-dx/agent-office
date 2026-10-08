import type { ProjectColor, ProjectIcon } from '@agent-office/shared';
import {
  Briefcase,
  ChartColumn,
  Code,
  FileText,
  Folder,
  Globe,
  MapPin,
  Megaphone,
  Package,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Every Turkish word of the Projects section that is not a status (the statuses are in
 * lib/status.ts), and the pictogram of each project icon. The colour and the icon of a project
 * come from the two fixed sets of the shared contract (8 October 2026, decision 17).
 */

/**
 * The fill class of each project colour (the tokens --project-* of index.css), for the project
 * tile and the swatches of the colour picker. Written out in full: Tailwind generates a class only
 * for a name it finds in the source.
 */
export const PROJECT_FILL: Record<ProjectColor, string> = {
  gray: 'bg-project-gray',
  red: 'bg-project-red',
  orange: 'bg-project-orange',
  green: 'bg-project-green',
  teal: 'bg-project-teal',
  blue: 'bg-project-blue',
  purple: 'bg-project-purple',
  pink: 'bg-project-pink',
};

/** The pictogram of a project icon; drawn only inside the project tile. */
export const PROJECT_ICON: Record<ProjectIcon, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  code: Code,
  globe: Globe,
  megaphone: Megaphone,
  wrench: Wrench,
  chart: ChartColumn,
  document: FileText,
  pin: MapPin,
  bolt: Zap,
  people: Users,
  box: Package,
};

/** The name of a colour, for a screen reader and for a person who cannot tell the swatches apart. */
export const COLOR_NAME: Record<ProjectColor, string> = {
  gray: 'Gri',
  red: 'Kırmızı',
  orange: 'Turuncu',
  green: 'Yeşil',
  teal: 'Turkuaz',
  blue: 'Mavi',
  purple: 'Mor',
  pink: 'Pembe',
};

export const ICON_NAME: Record<ProjectIcon, string> = {
  folder: 'Klasör',
  briefcase: 'Çanta',
  code: 'Kod',
  globe: 'Dünya',
  megaphone: 'Megafon',
  wrench: 'Anahtar',
  chart: 'Grafik',
  document: 'Belge',
  pin: 'Konum',
  bolt: 'Şimşek',
  people: 'Kişiler',
  box: 'Kutu',
};
